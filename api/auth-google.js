import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { idToken } = req.body ?? {};
    if (!idToken) return res.status(400).json({ error: "idToken ausente" });

    const expectedAud = process.env.GOOGLE_CLIENT_ID;

    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: expectedAud,
    });

    const appSecret = new TextEncoder().encode(process.env.APP_JWT_SECRET);
    const appJwt = await new SignJWT({ sub: payload.sub, email: payload.email })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(appSecret);

    return res.status(200).json({ appJwt, email: payload.email });
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }
}
