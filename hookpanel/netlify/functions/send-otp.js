// netlify/functions/send-otp.js
// EmailJS를 서버사이드에서 호출 - API 키가 클라이언트에 노출되지 않음

const https = require('https');

// 인메모리 OTP 저장소 (Netlify Functions는 stateless이므로 짧은 유효시간용)
// 실제 운영시 Redis나 Supabase 테이블 권장
const otpStore = new Map();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sendEmailJS(serviceId, templateId, publicKey, templateParams) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      template_params: templateParams
    });

    const options = {
      hostname: 'api.emailjs.com',
      path: '/api/v1.0/email/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(data);
        else reject(new Error(`EmailJS error: ${res.statusCode} ${data}`));
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  // CORS 헤더
  const headers = {
    'Access-Control-Allow-Origin': process.env.SITE_URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email, action } = JSON.parse(event.body || '{}');

    if (!email || !action) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '이메일과 action이 필요합니다' }) };
    }

    // 이메일 형식 검증
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '올바른 이메일 형식이 아닙니다' }) };
    }

    if (action === 'send') {
      // Rate limiting: 같은 이메일로 1분에 1회만
      const existing = otpStore.get(email);
      if (existing && Date.now() - existing.createdAt < 60000) {
        return {
          statusCode: 429, headers,
          body: JSON.stringify({ error: '1분 후에 다시 시도해주세요' })
        };
      }

      const code = generateOTP();
      const expiresAt = Date.now() + 15 * 60 * 1000; // 15분

      otpStore.set(email, { code, expiresAt, createdAt: Date.now() });

      // 만료된 항목 정리
      for (const [key, val] of otpStore.entries()) {
        if (Date.now() > val.expiresAt) otpStore.delete(key);
      }

      const timeStr = new Date(expiresAt).toLocaleTimeString('ko-KR');

      await sendEmailJS(
        process.env.EMAILJS_SERVICE_ID,
        process.env.EMAILJS_TEMPLATE_ID,
        process.env.EMAILJS_PUBLIC_KEY,
        { to_email: email, passcode: code, time: timeStr, email }
      );

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, message: '인증코드를 발송했습니다' })
      };

    } else if (action === 'verify') {
      const { code } = JSON.parse(event.body);
      const stored = otpStore.get(email);

      if (!stored) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: '인증코드를 먼저 요청해주세요' }) };
      }

      if (Date.now() > stored.expiresAt) {
        otpStore.delete(email);
        return { statusCode: 400, headers, body: JSON.stringify({ error: '인증코드가 만료되었습니다' }) };
      }

      if (stored.code !== code) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: '인증코드가 올바르지 않습니다' }) };
      }

      otpStore.delete(email);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, message: '이메일 인증 완료' })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: '올바른 action이 아닙니다' }) };

  } catch (err) {
    console.error('send-otp error:', err);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: '서버 오류가 발생했습니다' })
    };
  }
};
