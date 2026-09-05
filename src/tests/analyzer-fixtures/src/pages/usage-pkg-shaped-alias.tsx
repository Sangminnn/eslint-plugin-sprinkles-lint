import { aliasCard } from '@components/reexporter';
import { baseUrlCard } from 'components/Foo';

export const PkgShapedAliasPage = () => (
  <div>
    <span className={aliasCard} />
    <span className={baseUrlCard} />
  </div>
);
