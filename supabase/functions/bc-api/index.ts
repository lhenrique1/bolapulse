import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Cliente com service_role — nunca exposto ao app
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-bc-token',
  'Content-Type': 'application/json',
}

function resp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

function hashSenha(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0
  }
  return 'h' + Math.abs(h).toString(36)
}

function gerarToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + Date.now().toString(36)
}

// Valida token e retorna user_id
async function autenticar(token: string) {
  if (!token) return null
  const { data } = await supabase
    .from('bc_sessoes')
    .select('user_id, expira_em, ativo')
    .eq('token', token)
    .single()
  if (!data || !data.ativo) return null
  if (new Date(data.expira_em) < new Date()) return null
  return data.user_id as string
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { body = {} }

  const action = body.action as string
  const token = req.headers.get('x-bc-token') || body.token as string

  // ──────────────────────────────────────────────────────────
  // CADASTRO
  // ──────────────────────────────────────────────────────────
  if (action === 'cadastro') {
    const { nome, email, senha, telefone, dataNasc } = body as Record<string, string>
    if (!nome || !email || !senha) return resp({ ok: false, msg: 'Preencha todos os campos' }, 400)
    if (senha.length < 6) return resp({ ok: false, msg: 'Senha minima de 6 caracteres' }, 400)

    // Verifica email duplicado
    const { data: existe } = await supabase
      .from('bc_usuarios')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single()
    if (existe) return resp({ ok: false, msg: 'Email ja cadastrado' }, 409)

    const expira = new Date()
    expira.setDate(expira.getDate() + 7)

    const { data: novoUser, error } = await supabase
      .from('bc_usuarios')
      .insert({
        nome: nome.trim(),
        email: email.toLowerCase().trim(),
        senha: hashSenha(senha),
        telefone: telefone || null,
        data_nascimento: dataNasc || null,
        plano: 'trial',
        status: 'ativo',
        expira_em: expira.toISOString(),
        criado_em: new Date().toISOString(),
      })
      .select('id, nome, email, plano, status, expira_em')
      .single()

    if (error || !novoUser) return resp({ ok: false, msg: 'Erro ao criar conta' }, 500)

    // Cria sessão
    const sessaoToken = gerarToken()
    const expiraSessao = new Date()
    expiraSessao.setDate(expiraSessao.getDate() + 30)
    await supabase.from('bc_sessoes').insert({
      user_id: novoUser.id,
      token: sessaoToken,
      expira_em: expiraSessao.toISOString(),
    })

    return resp({ ok: true, token: sessaoToken, user: novoUser })
  }

  // ──────────────────────────────────────────────────────────
  // LOGIN
  // ──────────────────────────────────────────────────────────
  if (action === 'login') {
    const { email, senha } = body as Record<string, string>
    if (!email || !senha) return resp({ ok: false, msg: 'Informe email e senha' }, 400)

    const { data: user } = await supabase
      .from('bc_usuarios')
      .select('id, nome, email, plano, status, expira_em')
      .eq('email', email.toLowerCase().trim())
      .eq('senha', hashSenha(senha))
      .single()

    if (!user) return resp({ ok: false, msg: 'Email ou senha incorretos' }, 401)
    if (user.status === 'bloqueado') return resp({ ok: false, msg: 'Conta bloqueada. Entre em contato com suporte.' }, 403)
    if (user.status === 'inativo') return resp({ ok: false, msg: 'Conta inativa.' }, 403)

    // Atualiza ultimo acesso
    await supabase.from('bc_usuarios').update({ ultimo_acesso: new Date().toISOString() }).eq('id', user.id)

    // Cria sessão
    const sessaoToken = gerarToken()
    const expira = new Date()
    expira.setDate(expira.getDate() + 30)
    await supabase.from('bc_sessoes').insert({
      user_id: user.id,
      token: sessaoToken,
      expira_em: expira.toISOString(),
    })

    return resp({ ok: true, token: sessaoToken, user })
  }

  // ──────────────────────────────────────────────────────────
  // VALIDAR TOKEN (verifica se ainda está logado)
  // ──────────────────────────────────────────────────────────
  if (action === 'validar') {
    const userId = await autenticar(token)
    if (!userId) return resp({ ok: false, msg: 'Sessao expirada' }, 401)

    const { data: user } = await supabase
      .from('bc_usuarios')
      .select('id, nome, email, plano, status, expira_em')
      .eq('id', userId)
      .single()

    if (!user || user.status !== 'ativo') return resp({ ok: false, msg: 'Acesso negado' }, 403)
    return resp({ ok: true, user })
  }

  // ──────────────────────────────────────────────────────────
  // LOGOUT
  // ──────────────────────────────────────────────────────────
  if (action === 'logout') {
    if (token) {
      await supabase.from('bc_sessoes').update({ ativo: false }).eq('token', token)
    }
    return resp({ ok: true })
  }

  // ──────────────────────────────────────────────────────────
  // GET DADOS (apostas, banca, sites...)
  // ──────────────────────────────────────────────────────────
  if (action === 'getData') {
    const userId = await autenticar(token)
    if (!userId) return resp({ ok: false, msg: 'Nao autenticado' }, 401)

    const key = body.key as string
    if (!key) return resp({ ok: false, msg: 'key obrigatorio' }, 400)

    const { data } = await supabase
      .from('betcontrol_storage')
      .select('value')
      .eq('user_id', userId)
      .eq('key', key)
      .single()

    return resp({ ok: true, value: data?.value ?? null })
  }

  // ──────────────────────────────────────────────────────────
  // SET DADOS
  // ──────────────────────────────────────────────────────────
  if (action === 'setData') {
    const userId = await autenticar(token)
    if (!userId) return resp({ ok: false, msg: 'Nao autenticado' }, 401)

    const key = body.key as string
    const value = body.value as string
    if (!key) return resp({ ok: false, msg: 'key obrigatorio' }, 400)

    await supabase.from('betcontrol_storage').upsert(
      { user_id: userId, key, value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    )
    return resp({ ok: true })
  }

  // ──────────────────────────────────────────────────────────
  // SET DADOS EM LOTE
  // ──────────────────────────────────────────────────────────
  if (action === 'setDataBatch') {
    const userId = await autenticar(token)
    if (!userId) return resp({ ok: false, msg: 'Nao autenticado' }, 401)

    const items = body.items as Array<[string, string]>
    if (!items?.length) return resp({ ok: true })

    const rows = items.map(([key, value]) => ({
      user_id: userId, key, value,
      updated_at: new Date().toISOString()
    }))
    await supabase.from('betcontrol_storage').upsert(rows, { onConflict: 'user_id,key' })
    return resp({ ok: true })
  }

  return resp({ ok: false, msg: 'Acao desconhecida' }, 400)
})
