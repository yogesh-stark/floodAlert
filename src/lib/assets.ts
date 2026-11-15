import heroFloodSensorImg from '../assets/images/hero_flood_sensor_1794746950938.jpg';
import reportWaterloggingAnnaImg from '../assets/images/report_waterlogging_anna_1794746956322.jpg';
import reportDrainBlockedImg from '../assets/images/report_drain_blocked_1794746953773.jpg';
import shelterCommunityHubImg from '../assets/images/shelter_community_hub_1794746951598.jpg';

export const ASSETS = {
  heroSensor: heroFloodSensorImg,
  reportAnna: reportWaterloggingAnnaImg,
  reportDrain: reportDrainBlockedImg,
  shelterHub: shelterCommunityHubImg,
};

export function resolveReportPhoto(photoKey?: string): string | undefined {
  if (!photoKey) return undefined;
  if (photoKey === 'asset:report_anna') return reportWaterloggingAnnaImg;
  if (photoKey === 'asset:report_drain') return reportDrainBlockedImg;
  if (photoKey === 'asset:shelter_hub') return shelterCommunityHubImg;
  return photoKey;
}
