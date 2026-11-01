// The desktop loader supplies this component; the published Node module is empty.
export function Icon({ name }: { name?: string }) {
  return <span aria-hidden="true" data-icon={name} />;
}
