import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'storage/**/*', 'public/**/*', 'node_modules/**/*']
  },
  firebaseRulesPlugin.configs['flat/recommended']
]
