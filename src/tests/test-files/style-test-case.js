// style 함수 테스트 케이스
const style = (obj) => obj;
const sprinkles = (obj) => obj;

// 일반 style 객체
export const simpleStyle = style({
  color: 'gray-900',
  fontWeight: 700,
  borderColor: 'gray-900',
  position: 'relative',
  display: 'flex',
  backgroundColor: 'white',
});

// style 배열
export const arrayStyle = style([
  {
    color: 'gray-900',
    fontWeight: 700,
    borderColor: 'gray-900',
    position: 'relative',
  },
  {
    display: 'flex',
    backgroundColor: 'white',
    borderStyle: 'solid',
    borderWidth: 1,
  },
]);

// 이미 sprinkles를 일부 사용한 style 배열
export const mixedStyle = style([
  sprinkles({
    position: 'relative',
    display: 'flex',
  }),
  {
    color: 'gray-900', // 이것도 sprinkles에 있는 속성
    fontWeight: 700, // 이것도 sprinkles에 있는 속성
    borderWidth: 1, // 이건 sprinkles에 없는 속성
    borderStyle: 'solid', // 이건 sprinkles에 없는 속성
  },
]);
