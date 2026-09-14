export function requiresHomeScreenForPush({
  userAgent,
  platform,
  maxTouchPoints,
  standalone,
}: {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
}) {
  const isIOS = /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  return isIOS && !standalone;
}
