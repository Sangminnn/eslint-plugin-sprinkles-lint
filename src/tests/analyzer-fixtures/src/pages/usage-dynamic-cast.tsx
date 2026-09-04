import * as styles from '../dynamic2.css';

export const DynamicCastPage = ({ kind }: { kind: string }) => <div className={(styles as never)[kind]}>dyn</div>;
