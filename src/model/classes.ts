/**
 * Predicted level -> signal bars.
 *
 * Thresholds and where they come from:
 *  4 bars  >= -67 dBm  Cisco Voice over WLAN Design Guide 4.1, ch. 3: -67 dBm
 *                      cell edge for voice and real-time traffic.
 *  3 bars  >= -74 dBm  IEEE Std 802.11 OFDM PHY minimum receiver sensitivity
 *                      for 24 Mbit/s (16-QAM 1/2), 20 MHz channel.
 *  2 bars  >= -79 dBm  same table, 12 Mbit/s (QPSK 1/2).
 *  1 bar   >= -82 dBm  same table, 6 Mbit/s (BPSK 1/2), the lowest OFDM rate.
 *  0 bars  <  -82 dBm  below the level a compliant receiver must decode at all.
 *
 * "Covered" in FullBars means 3 bars or more.
 */
export const THRESHOLDS = [-67, -74, -79, -82] as const;

export type Bars = 0 | 1 | 2 | 3 | 4;

export function barsFor(dbm: number): Bars {
  if (dbm >= THRESHOLDS[0]) return 4;
  if (dbm >= THRESHOLDS[1]) return 3;
  if (dbm >= THRESHOLDS[2]) return 2;
  if (dbm >= THRESHOLDS[3]) return 1;
  return 0;
}

export const BAR_LABEL: Record<Bars, string> = {
  4: 'Strong',
  3: 'Good',
  2: 'Weak',
  1: 'Barely',
  0: 'Dead zone',
};

export const BAR_MEANING: Record<Bars, string> = {
  4: 'Video calls and streaming (≥ −67 dBm)',
  3: 'Browsing and lectures (≥ −74 dBm, 24 Mbit/s)',
  2: 'Slow (≥ −79 dBm, 12 Mbit/s)',
  1: 'Drops often (≥ −82 dBm, 6 Mbit/s)',
  0: 'No reliable link (< −82 dBm)',
};

export const COVERED_MIN_BARS: Bars = 3;
