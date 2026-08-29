module.exports = {
  // Next.js only applies Tailwind through an explicit PostCSS config; without
  // this file the directives in globals.css pass through untouched and no
  // utilities are generated (dev and build alike).
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
