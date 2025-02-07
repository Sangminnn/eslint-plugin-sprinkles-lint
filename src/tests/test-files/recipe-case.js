const recipe = (obj) => obj;

const testStyle = recipe({
  base: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'row',
  },
  variants: {
    color: ['red', 'blue'],
  },
});
