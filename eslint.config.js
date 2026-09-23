import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import hooks from "eslint-plugin-react-hooks";
export default tseslint.config(
  { ignores: ["dist/**", "src-tauri/target/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": hooks },
    rules: { ...hooks.configs.recommended.rules },
  },
);
