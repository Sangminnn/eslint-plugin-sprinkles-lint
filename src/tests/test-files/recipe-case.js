const recipe = (obj) => obj;
const sprinkles = (obj) => obj;
const vars = {
  colors: {
    'gray-50': '#f6f6f6',
  },
};

// 예제 1: base가 객체인 경우
const testRecipe1 = recipe({
  base: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'row',
    backgroundColor: vars.colors['gray-50'],
  },
  variants: {
    color: {
      red: {
        display: 'block',
      },
      blue: {
        display: 'inline',
      },
    },
  },
});

// 예제 2: base가 배열인 경우
const testRecipe2 = recipe({
  base: [
    {
      position: 'absolute',
      display: 'flex',
    },
  ],
  variants: {
    hasImage: {
      true: {
        borderWidth: 1,
        borderStyle: 'solid',
      },
    },
  },
});
