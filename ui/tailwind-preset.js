import plugin from "tailwindcss/plugin";

/**
 * Shared Tezzeract Tailwind preset.
 *
 * Consumers extend this so every product resolves the same tokens. Values are
 * read from CSS custom properties where a host app may re-theme them at
 * runtime (see `--tz-accent`), with the Tezzeract default as the fallback.
 */

/** Tezzeract brand values, as used by TezzeractButton / TezzeractSendButton. */
export const brand = {
  cyan: "#20C8F9",
  blue: "#009BE9",
  deep: "#00378A",
  edge: "#409AFF",
};

/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      colors: {
        // `bg-border` is referenced by resizable.tsx.
        border: "var(--tz-border, #e5e7eb)",
        accent: {
          DEFAULT: "var(--tz-accent, #009BE9)",
          deep: "var(--tz-accent-deep, #00378A)",
        },
        tz: brand,
      },
      borderRadius: {
        tz: "var(--tz-radius, 0.75rem)",
      },
      ringColor: {
        accent: "var(--tz-accent, #009BE9)",
      },
    },
  },
  plugins: [
    plugin(({ addUtilities }) => {
      // Button's `gradient` variant composes these two utilities.
      addUtilities({
        ".gradient-primary": {
          backgroundImage:
            "radial-gradient(64.46% 80% at 50.53% 0%, var(--tz-accent, #009BE9) 0%, var(--tz-accent-deep, #00378A) 100%)",
        },
        ".gradient-primary-hover": {
          backgroundImage:
            "radial-gradient(93.12% 100% at 50.53% 0%, var(--tz-accent, #009BE9) 0%, var(--tz-accent-deep, #00378A) 100%)",
        },
      });
    }),
  ],
};
