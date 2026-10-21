import type { PluginIconProps } from "@getpaseo/plugin/client";

// The desktop loader supplies this component; the published Node module is empty.
export function Icon({ name }: PluginIconProps) {
  return <span aria-hidden="true" data-icon={name} />;
}
