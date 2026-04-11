export default async function handler(request, response) {
  const API_KEY = process.env.RAPIDAPI_KEY;
  // Pega a data enviada pelo site, ou usa a data de hoje como padrão
  const { date } = request.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  const url = `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${targetDate}&timezone=America/Sao_Paulo`;

  try {
    const res = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': API_KEY,
        'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
      }
    });
    const data = await res.json();
    
    // Retorna os jogos encontrados
    return response.status(200).json(data.response || []);
  } catch (e) {
    return response.status(500).json({ error: e.message });
  }
}
