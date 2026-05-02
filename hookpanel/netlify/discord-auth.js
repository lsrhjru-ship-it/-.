// netlify/functions/discord-auth.js
// Discord OAuth token exchange - Client Secret을 서버에서만 사용

const https = require('https');

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method: 'POST', headers };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method: 'GET', headers };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.SITE_URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { code } = JSON.parse(event.body || '{}');
    if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: 'code가 필요합니다' }) };

    const siteUrl = process.env.SITE_URL || 'https://hookforwarding.netlify.app';

    // 1. Authorization code → Access token 교환
    const tokenBody = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET, // ← 서버에서만 사용
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${siteUrl}/discord-callback`
    }).toString();

    const tokenRes = await httpsPost(
      'discord.com',
      '/api/oauth2/token',
      { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) },
      tokenBody
    );

    if (tokenRes.status !== 200) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Discord token 교환 실패' }) };
    }

    const accessToken = tokenRes.data.access_token;

    // 2. 유저 정보 가져오기
    const userRes = await httpsGet(
      'discord.com',
      '/api/users/@me',
      { Authorization: `Bearer ${accessToken}` }
    );

    if (userRes.status !== 200) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Discord 유저 정보 조회 실패' }) };
    }

    const discordUser = userRes.data;

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        user: {
          discordId: discordUser.id,
          username: discordUser.global_name || discordUser.username,
          email: discordUser.email || `discord_${discordUser.id}@discord.local`,
          picture: discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : ''
        }
      })
    };

  } catch (err) {
    console.error('discord-auth error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: '서버 오류' }) };
  }
};
