// 간단한 테스트 파일
function recipe(obj) {
  return obj;
}
function sprinkles(obj) {
  return obj;
}
function style(obj) {
  return obj;
}

const vars = {
  colors: {
    'gray-900': '#2D2D2D',
    'red-500': '#FF0000',
  },
};

// SPRINKLES 적용이 필요한 속성이 variants에 직접 들어있는 경우
const button = recipe({
  base: [],
  variants: {
    selected: {
      true: {
        color: 'gray-900', // SPRINKLES: 이 속성은 sprinkles에 있어야 함
        fontWeight: 700, // SPRINKLES: 이 속성은 sprinkles에 있어야 함
      },
    },
  },
});
