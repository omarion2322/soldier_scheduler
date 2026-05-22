/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        prefer: '#16a34a',
        cant: '#dc2626',
        neutral: '#e5e7eb',
      },
    },
  },
  plugins: [],
};
