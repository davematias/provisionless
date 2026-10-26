import { DEFAULT_THEME, THEME_STORAGE_KEY } from "../lib/theme.ts";

const SCRIPT = `(function(){try{var key=${JSON.stringify(THEME_STORAGE_KEY)};var fallback=${JSON.stringify(DEFAULT_THEME)};var stored=localStorage.getItem(key);var theme=stored==="light"||stored==="dark"||stored==="system"?stored:fallback;var dark=theme==="dark"||(theme==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);}catch(e){}})();`;

/**
 * Inline script that applies the stored theme before hydration to avoid a flash of the wrong theme.
 */
export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
