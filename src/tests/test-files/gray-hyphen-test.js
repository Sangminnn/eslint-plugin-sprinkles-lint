// Test case: color with hyphen (gray-0) in sprinkles
// Expected: NO lint error because gray-0 is defined in sprinkles config

// Case 1: sprinkles에 gray-0이 있고, style 배열 내 sprinkles에서 gray-0 사용
// → 에러 없어야 함
export const correctCase = style([
  sprinkles({
    width: '100%',
    color: 'gray-0',
    fontSize: 16,
    fontWeight: 500,
  }),
  {
    lineHeight: '150%',
    textDecoration: 'underline',
  },
]);

// Case 1-B: textAlign 추가 (실제 프로젝트 케이스와 동일)
// → 에러 없어야 함
export const correctCaseWithTextAlign = style([
  sprinkles({
    width: '100%',
    color: 'gray-0',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 500,
  }),
  {
    lineHeight: '150%',
    textDecoration: 'underline',
  },
]);

// Case 2: sprinkles 없이 style 객체에서 gray-0 사용
// → 에러 발생해야 함 (sprinkles로 이동 필요)
export const shouldError = style([
  sprinkles({
    width: '100%',
    color: 'gray-0',
    fontSize: 16,
    fontWeight: 500
  }),
  {
    lineHeight: '150%'
  }
]);

// Case 3: style 배열에서 sprinkles 없이 사용
// → 에러 발생해야 함
export const shouldErrorArray = sprinkles({
    width: '100%',
    color: 'gray-0',
    fontSize: 16
  });

// Case 4: sprinkles에 정의되지 않은 color 값 (gray0 - 하이픈 없음)
// → 에러 없어야 함 (sprinkles에 없으므로 style에 남아있어도 됨)
export const undefinedColor = style([
  sprinkles({
    width: '100%',
    fontSize: 16,
  }),
  {
    color: 'gray0',
    lineHeight: '150%',
  },
]);

// Case 5: 스크린샷과 동일한 케이스 - viewHistoryLink
// sprinkles 내부에 gray-0이 있는데 에러가 발생하는지 확인
export const viewHistoryLink = style([
  sprinkles({
    width: '100%',
    color: 'gray-0',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 500,
  }),
  {
    lineHeight: '150%',
    textDecoration: 'underline',
  },
]);

// Case 6: fontSize가 17일 때 (sprinkles에 17이 없음)
// → 에러 발생해야 함 (fontSize 17은 sprinkles에 정의 안됨)
export const viewHistoryLinkWithFontSize17 = style([
  sprinkles({
    width: '100%',
    color: 'gray-0',
    textAlign: 'center',
    fontWeight: 500
  }),
  {
    fontSize: 17,
    lineHeight: '150%',
    textDecoration: 'underline'
  }
]);

// Case 7: 실제 프로젝트 케이스 - votedButtonText
// sprinkles 내부 값들이 모두 config에 정의되어 있음
// → 에러 없어야 함
export const votedButtonText = style([
  sprinkles({
    color: 'gray-0',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 700,
  }),
  {
    lineHeight: '150%',
  },
]);
