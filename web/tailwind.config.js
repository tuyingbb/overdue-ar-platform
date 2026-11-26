/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f5f3ee',
        surface: '#fffdf9',
        ink: '#1a211d',
        'ink-2': '#4a544d',
        'ink-3': '#5f675f',
        line: '#d8d3c6',
        'line-soft': '#e8e4d9',
        accent: '#2f6b4f',
        'accent-2': '#3f8a66',
        warn: '#b45309',
        danger: '#b91c1c',
        info: '#1d4ed8',
        blue: '#1e4e8c'
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Microsoft YaHei"', 'Segoe UI', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(26,33,29,0.04), 0 1px 3px rgba(26,33,29,0.06)'
      }
    }
  },
  plugins: []
};
