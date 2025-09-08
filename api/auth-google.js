import { decodeJwt, importJWK, jwtVerify, SignJWT } from "jose";

async function verifyGoogleIdToken(idToken, expectedAud) {
  const { header, payload } = decodeJwt(idToken, { complete: true });
  const kid = header.kid;

  const jwksRes = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const { keys } = await jwksRes.json();
  const jwk = keys.find(k => k.kid === kid);
  if (!jwk) throw new Error("JWK não encontrado");

  const key = await importJWK(jwk, "RS256");
  const { payload: verified } = await jwtVerify(idToken, key, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: expectedAud
  });
  return verified;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { idToken } = req.body ?? {};
    if (!idToken) return res.status(400).json({ error: "idToken ausente" });

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const user = await verifyGoogleIdToken(idToken, googleClientId);

    const appSecret = new TextEncoder().encode(process.env.APP_JWT_SECRET);
    const appJwt = await new SignJWT({ sub: user.sub, email: user.email })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(appSecret);

    return res.status(200).json({ appJwt, email: user.email });
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }
}
