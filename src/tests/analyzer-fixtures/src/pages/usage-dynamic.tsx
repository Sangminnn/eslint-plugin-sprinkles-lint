import * as styles from '../dynamic.css';

export const DynamicPage = ({ kind }: { kind: string }) => <div className={styles[kind]}>dyn</div>;
