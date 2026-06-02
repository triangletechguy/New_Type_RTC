/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        rtc: {
          ink: '#14071f',
          plum: '#351344',
          violet: '#7214a8',
          gold: '#ffcc32',
          coral: '#f55767',
          mint: '#77ead1',
        },
      },
      boxShadow: {
        rtc: '0 18px 50px rgba(20, 7, 31, 0.28)',
      },
    },
  },
  plugins: [],
}
