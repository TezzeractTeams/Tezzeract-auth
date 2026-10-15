import preset from "@tezzeract/ui/tailwind-preset";

/**
 * Extends the shared Tezzeract preset. The content globs include the ui
 * package because its components are consumed as source, so their utility
 * classes have to be visible to the scanner or they are stripped.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  presets: [preset],
  // The ui globs are written out rather than "../ui/**" so the scanner does
  // not walk that package's node_modules.
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../ui/*.tsx", "../ui/utils/*.ts"],
};
