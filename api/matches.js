export default async function handler(request, response) {
  const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
  const url = 'https://api.football-data.org/v4/matches';

  try {
    const res = await fetch(url, {
      headers: { 'X-Auth-Token': API_KEY }
    });
    
    if (!res.ok) {
        return response.status(res.status).json({ error: "Erro na API externa" });
    }

    const data = await res.json();
    
    // Adicionando cabeçalhos para evitar erros de cache
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    return response.status(200).json(data);
  } catch (e) {
    return response.status(500).json({ error: e.message });
  }
}
