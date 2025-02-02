# ESLint Plugin for Vanilla Extract Sprinkles

Vanilla Extract의 Sprinkles를 사용할 때 이미 선언된 Sprinkles를 사용하지 않고 style을 선언하는 경우에 경고하는 ESLint 플러그인입니다.

## 설치

```bash
npm install eslint-plugin-vanilla-extract-sprinkles
```

## 사용

```js
// .eslintrc.js
module.exports = {
  plugins: ["vanilla-extract"],
  rules: {
    "vanilla-extract/no-use-style-declared-sprinkles": "error",
  },
};
```
