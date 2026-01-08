/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Roboto', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Material v3 Primary
        primary: {
          DEFAULT: "rgb(var(--md-sys-color-primary) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-primary-container) / <alpha-value>)",
        },
        "on-primary": {
          DEFAULT: "rgb(var(--md-sys-color-on-primary) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-on-primary-container) / <alpha-value>)",
        },

        // Material v3 Secondary
        secondary: {
          DEFAULT: "rgb(var(--md-sys-color-secondary) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-secondary-container) / <alpha-value>)",
        },
        "on-secondary": {
          DEFAULT: "rgb(var(--md-sys-color-on-secondary) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-on-secondary-container) / <alpha-value>)",
        },

        // Material v3 Tertiary
        tertiary: {
          DEFAULT: "rgb(var(--md-sys-color-tertiary) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-tertiary-container) / <alpha-value>)",
        },
        "on-tertiary": {
          DEFAULT: "rgb(var(--md-sys-color-on-tertiary) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-on-tertiary-container) / <alpha-value>)",
        },

        // Material v3 Error
        error: {
          DEFAULT: "rgb(var(--md-sys-color-error) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-error-container) / <alpha-value>)",
        },
        "on-error": {
          DEFAULT: "rgb(var(--md-sys-color-on-error) / <alpha-value>)",
          container: "rgb(var(--md-sys-color-on-error-container) / <alpha-value>)",
        },

        // Material v3 Surface
        surface: {
          DEFAULT: "rgb(var(--md-sys-color-surface) / <alpha-value>)",
          variant: "rgb(var(--md-sys-color-surface-variant) / <alpha-value>)",
          container: {
            lowest: "rgb(var(--md-sys-color-surface-container-lowest) / <alpha-value>)",
            low: "rgb(var(--md-sys-color-surface-container-low) / <alpha-value>)",
            DEFAULT: "rgb(var(--md-sys-color-surface-container) / <alpha-value>)",
            high: "rgb(var(--md-sys-color-surface-container-high) / <alpha-value>)",
            highest: "rgb(var(--md-sys-color-surface-container-highest) / <alpha-value>)",
          },
        },
        "on-surface": {
          DEFAULT: "rgb(var(--md-sys-color-on-surface) / <alpha-value>)",
          variant: "rgb(var(--md-sys-color-on-surface-variant) / <alpha-value>)",
        },

        // Material v3 Outline
        outline: {
          DEFAULT: "rgb(var(--md-sys-color-outline) / <alpha-value>)",
          variant: "rgb(var(--md-sys-color-outline-variant) / <alpha-value>)",
        },

        // Material v3 Inverse
        inverse: {
          surface: "rgb(var(--md-sys-color-inverse-surface) / <alpha-value>)",
          "on-surface": "rgb(var(--md-sys-color-inverse-on-surface) / <alpha-value>)",
          primary: "rgb(var(--md-sys-color-inverse-primary) / <alpha-value>)",
        },

        // Material v3 Other
        scrim: "rgb(var(--md-sys-color-scrim) / <alpha-value>)",
        shadow: "rgb(var(--md-sys-color-shadow) / <alpha-value>)",

        // Legacy color mappings for compatibility
        background: "rgb(var(--md-sys-color-surface) / <alpha-value>)",
        foreground: "rgb(var(--md-sys-color-on-surface) / <alpha-value>)",
        card: {
          DEFAULT: "rgb(var(--md-sys-color-surface-container-low) / <alpha-value>)",
          foreground: "rgb(var(--md-sys-color-on-surface) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--md-sys-color-surface-container) / <alpha-value>)",
          foreground: "rgb(var(--md-sys-color-on-surface) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--md-sys-color-surface-variant) / <alpha-value>)",
          foreground: "rgb(var(--md-sys-color-on-surface-variant) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--md-sys-color-secondary-container) / <alpha-value>)",
          foreground: "rgb(var(--md-sys-color-on-secondary-container) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--md-sys-color-error) / <alpha-value>)",
          foreground: "rgb(var(--md-sys-color-on-error) / <alpha-value>)",
        },
        border: "rgb(var(--md-sys-color-outline-variant) / <alpha-value>)",
        input: "rgb(var(--md-sys-color-outline) / <alpha-value>)",
        ring: "rgb(var(--md-sys-color-primary) / <alpha-value>)",
      },
      borderRadius: {
        // Material v3 Shape System
        'none': '0px',
        'extra-small': 'var(--md-sys-shape-corner-extra-small)',
        'small': 'var(--md-sys-shape-corner-small)',
        'medium': 'var(--md-sys-shape-corner-medium)',
        'large': 'var(--md-sys-shape-corner-large)',
        'extra-large': 'var(--md-sys-shape-corner-extra-large)',
        'full': 'var(--md-sys-shape-corner-full)',
        // Legacy
        lg: "var(--md-sys-shape-corner-large)",
        md: "var(--md-sys-shape-corner-medium)",
        sm: "var(--md-sys-shape-corner-small)",
      },
      boxShadow: {
        // Material v3 Elevation shadows
        'elevation-1': '0px 1px 2px rgba(0, 0, 0, 0.3), 0px 1px 3px 1px rgba(0, 0, 0, 0.15)',
        'elevation-2': '0px 1px 2px rgba(0, 0, 0, 0.3), 0px 2px 6px 2px rgba(0, 0, 0, 0.15)',
        'elevation-3': '0px 1px 3px rgba(0, 0, 0, 0.3), 0px 4px 8px 3px rgba(0, 0, 0, 0.15)',
        'elevation-4': '0px 2px 3px rgba(0, 0, 0, 0.3), 0px 6px 10px 4px rgba(0, 0, 0, 0.15)',
        'elevation-5': '0px 4px 4px rgba(0, 0, 0, 0.3), 0px 8px 12px 6px rgba(0, 0, 0, 0.15)',
      },
      opacity: {
        // Material v3 State layer opacities
        '8': '0.08',
        '12': '0.12',
        '16': '0.16',
        '38': '0.38',
      },
      fontSize: {
        // Material v3 Type Scale
        'display-large': ['57px', { lineHeight: '64px', letterSpacing: '-0.25px' }],
        'display-medium': ['45px', { lineHeight: '52px', letterSpacing: '0px' }],
        'display-small': ['36px', { lineHeight: '44px', letterSpacing: '0px' }],
        'headline-large': ['32px', { lineHeight: '40px', letterSpacing: '0px' }],
        'headline-medium': ['28px', { lineHeight: '36px', letterSpacing: '0px' }],
        'headline-small': ['24px', { lineHeight: '32px', letterSpacing: '0px' }],
        'title-large': ['22px', { lineHeight: '28px', letterSpacing: '0px' }],
        'title-medium': ['16px', { lineHeight: '24px', letterSpacing: '0.15px', fontWeight: '500' }],
        'title-small': ['14px', { lineHeight: '20px', letterSpacing: '0.1px', fontWeight: '500' }],
        'body-large': ['16px', { lineHeight: '24px', letterSpacing: '0.5px' }],
        'body-medium': ['14px', { lineHeight: '20px', letterSpacing: '0.25px' }],
        'body-small': ['12px', { lineHeight: '16px', letterSpacing: '0.4px' }],
        'label-large': ['14px', { lineHeight: '20px', letterSpacing: '0.1px', fontWeight: '500' }],
        'label-medium': ['12px', { lineHeight: '16px', letterSpacing: '0.5px', fontWeight: '500' }],
        'label-small': ['11px', { lineHeight: '16px', letterSpacing: '0.5px', fontWeight: '500' }],
      },
    },
  },
  plugins: [],
}
