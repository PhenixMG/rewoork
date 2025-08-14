// eslint.config.js (ESM)
import js from "@eslint/js";
import globals from "globals";

export default [
    // Fichiers/dirs à ignorer
    {
        ignores: [
            "node_modules/",
            "dist/",
            "build/",
            "coverage/",
            ".git/",
            ".vscode/",
            ".idea/",
            "**/prisma/migrations/**"
        ],
    },
    // Règles pour le code JS du bot
    {
        files: ["**/*.js", "**/*.mjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.node,
                ...globals.es2022,
            },
        },
        rules: {
            ...js.configs.recommended.rules,
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "no-console": "off",
        },
    },
];