'use client';

import { useState, useEffect } from 'react';
import type { DeviceType } from '@/types';

export function useDeviceType(): {
  device: DeviceType;
  isPhone: boolean;
  isPC: boolean;
} {
  const [device, setDevice] = useState<DeviceType>('pc');

  useEffect(() => {
    function evaluateDevice(): DeviceType {
      if (typeof window === 'undefined') return 'pc';
      const width = window.innerWidth;
      const height = window.innerHeight;
      const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

      // PHONE = width under 768px, or a touch device with height under 500px (landscape phone)
      if (width < 768 || (isCoarsePointer && height < 500)) {
        return 'phone';
      }
      return 'pc';
    }

    const update = () => setDevice(evaluateDevice());
    update();

    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return {
    device,
    isPhone: device === 'phone',
    isPC: device === 'pc',
  };
}
