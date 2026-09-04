import clsx from 'clsx';
import * as styles from '../styles.css';
import { Button, Skeleton, Comp } from '../components/kit';

export const UnprovenPage = ({ wide }: { wide: boolean }) => {
  const aliased = styles.aliasVia;
  const spreadProps = { className: styles.spreadF };

  return (
    <div>
      <Button className={styles.composedB}>remove</Button>
      <div className={clsx(styles.clsxC1, styles.clsxC2)}>clsx</div>
      <div className={wide && styles.condC3 ? styles.condC3 : undefined}>cond</div>
      <Skeleton containerClassName={styles.skeletonE} />
      <Comp {...spreadProps} />
      <i className={aliased} />
    </div>
  );
};
