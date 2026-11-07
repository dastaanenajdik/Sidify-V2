import { ImageResponse } from "next/og";

export const alt = "Sidify — Free Music & Song Streaming Player";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PILLS = [
  "Full Songs Free",
  "Synced Lyrics",
  "Smart Song Radio",
  "Listen Together",
  "Movies & Series",
];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          backgroundColor: "#08080a",
          backgroundImage:
            "radial-gradient(circle at 85% 18%, rgba(250, 45, 72, 0.36) 0%, rgba(250, 45, 72, 0) 52%), radial-gradient(circle at 14% 88%, rgba(255, 91, 110, 0.18) 0%, rgba(255, 91, 110, 0) 48%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
          }}
        >
          <div
            style={{
              width: "76px",
              height: "76px",
              borderRadius: "18px",
              background: "linear-gradient(180deg, #ff5b6e 0%, #fa233b 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 16px 40px rgba(250, 35, 59, 0.45)",
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24">
              <path
                d="M16.3 7.7c-.95-1.55-2.6-2.4-4.55-2.4-2.65 0-4.55 1.45-4.55 3.5 0 4.75 9.6 2.55 9.6 7.5 0 2.15-2.05 3.75-4.95 3.75-2.2 0-4.05-.95-5.05-2.7"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span
              style={{
                fontSize: "40px",
                fontWeight: 800,
                letterSpacing: "-1px",
                lineHeight: 1.05,
              }}
            >
              Sidify
            </span>
            <span
              style={{
                fontSize: "18px",
                color: "#a1a1aa",
                marginTop: "4px",
              }}
            >
              Free Music, Songs & Entertainment Hub
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxWidth: "960px",
          }}
        >
          <div
            style={{
              fontSize: "66px",
              fontWeight: 800,
              letterSpacing: "-2.2px",
              lineHeight: 1.06,
            }}
          >
            Stream full songs, synced lyrics & listen together.
          </div>
          <div
            style={{
              fontSize: "26px",
              color: "#d4d4d8",
              marginTop: "20px",
              lineHeight: 1.4,
            }}
          >
            Ad-free online music player with personalized mixes, song radio, offline downloads & HD movies.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "12px",
            }}
          >
            {PILLS.map((label) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 20px",
                  borderRadius: "999px",
                  backgroundColor: "rgba(255, 255, 255, 0.09)",
                  border: "1px solid rgba(255, 255, 255, 0.14)",
                  fontSize: "18px",
                  fontWeight: 600,
                  color: "#f4f4f5",
                }}
              >
                {label}
              </div>
            ))}
          </div>
          <span
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "#ff5b6e",
            }}
          >
            sidify.vercel.app
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
