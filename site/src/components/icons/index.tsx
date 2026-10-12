// Icon layer. One family: Phosphor Icons (MIT), duotone weight, imported per icon from the
// server-safe entry so they tree-shake and render in server components. Sized to the type
// scale through `size` (defaults to 1em) and coloured by currentColor.
//
// Motorsport-specific marks that Phosphor does not have live in ./motorsport.tsx and are drawn
// on the same 256 unit grid with the same 16 unit stroke.

import type { ComponentType } from "react";
import type { IconProps as PhosphorProps } from "@phosphor-icons/react";
import {
  ArrowDown,
  LockSimple,
  Prohibit,
  ArrowRight,
  ArrowUp,
  ArrowsClockwise,
  ArrowsLeftRight,
  Broadcast,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartLineUp,
  ClockCounterClockwise,
  CloudRain,
  Coins,
  Crown,
  Drop,
  FastForward,
  Gauge,
  Garage,
  Infinity as InfinityIcon,
  Lightning,
  ListNumbers,
  MagnifyingGlass,
  MapTrifold,
  Medal,
  Minus,
  Moon,
  Pause,
  Play,
  Pulse,
  Rewind,
  Robot,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sun,
  Thermometer,
  Timer,
  Trophy,
  Warning,
  Wind,
  WifiSlash,
  WifiHigh,
} from "@phosphor-icons/react/dist/ssr";

export type IconProps = Omit<PhosphorProps, "weight"> & { label?: string };

export type IconComponent = ComponentType<IconProps>;

function duotone(Component: ComponentType<PhosphorProps>): IconComponent {
  const Wrapped = ({ label, size = "1em", ...rest }: IconProps) => {
    const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
    return <Component weight="duotone" size={size} {...a11y} {...rest} />;
  };
  Wrapped.displayName = `Duotone(${Component.displayName ?? "Icon"})`;
  return Wrapped;
}

export const IconTrophy = duotone(Trophy);
export const IconMedal = duotone(Medal);
export const IconCrown = duotone(Crown);
export const IconCoins = duotone(Coins);
export const IconBroadcast = duotone(Broadcast);
export const IconListNumbers = duotone(ListNumbers);
export const IconCalendar = duotone(CalendarBlank);
export const IconGarage = duotone(Garage);
export const IconMap = duotone(MapTrifold);
export const IconHistory = duotone(ClockCounterClockwise);
export const IconForecast = duotone(ChartLineUp);
export const IconPulse = duotone(Pulse);
export const IconTimer = duotone(Timer);
export const IconThermometer = duotone(Thermometer);
export const IconDrop = duotone(Drop);
export const IconWind = duotone(Wind);
export const IconGauge = duotone(Gauge);
export const IconRain = duotone(CloudRain);
export const IconPlay = duotone(Play);
export const IconPause = duotone(Pause);
export const IconSkipBack = duotone(SkipBack);
export const IconSkipForward = duotone(SkipForward);
export const IconRewind = duotone(Rewind);
export const IconFastForward = duotone(FastForward);
export const IconArrowUp = duotone(ArrowUp);
export const IconArrowDown = duotone(ArrowDown);
export const IconArrowRight = duotone(ArrowRight);
export const IconMinus = duotone(Minus);
export const IconSun = duotone(Sun);
export const IconMoon = duotone(Moon);
export const IconWarning = duotone(Warning);
export const IconSearch = duotone(MagnifyingGlass);
export const IconTransfers = duotone(ArrowsLeftRight);
export const IconWildcard = duotone(ArrowsClockwise);
export const IconBoost = duotone(Lightning);
export const IconLimitless = duotone(InfinityIcon);
export const IconShield = duotone(ShieldCheck);
export const IconAutopilot = duotone(Robot);
export const IconOffline = duotone(WifiSlash);
export const IconOnline = duotone(WifiHigh);
export const IconLock = duotone(LockSimple);
export const IconExclude = duotone(Prohibit);

export * from "./motorsport";
export const IconCaretDown = duotone(CaretDown);
export const IconCaretLeft = duotone(CaretLeft);
export const IconCaretRight = duotone(CaretRight);
