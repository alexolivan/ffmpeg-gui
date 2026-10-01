import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export interface NetworkInterfaceAddress {
  address: string;
  netmask?: string;
  broadcast?: string;
}

export interface NetworkInterfaceInfo {
  name: string;
  is_up: boolean;
  speed: number;
  mac?: string;
  ipv4_addresses: NetworkInterfaceAddress[];
  ipv6_addresses: NetworkInterfaceAddress[];
  is_loopback: boolean;
  is_default_gateway: boolean;
}

interface NetworkInterfaceSelectorProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  helperText?: string;
  API?: string;
  disabled?: boolean;
}

export const NetworkInterfaceSelector: React.FC<NetworkInterfaceSelectorProps> = ({
  value,
  onChange,
  label,
  helperText,
  API = '',
  disabled = false,
}) => {
  const { t } = useTranslation();
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    fetch(`${API}/api/system/network/interfaces`)
      .then((res) => (res.ok ? res.json() : { interfaces: [] }))
      .then((data) => {
        if (isMounted && Array.isArray(data.interfaces)) {
          setInterfaces(data.interfaces);
        }
      })
      .catch((err) => {
        console.error('Failed to load network interfaces:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [API]);

  // Extract all distinct IPv4 addresses from non-loopback interfaces
  const detectedIps = new Set<string>(['0.0.0.0', '127.0.0.1']);
  interfaces.forEach((iface) => {
    iface.ipv4_addresses.forEach((addr) => {
      if (addr.address) detectedIps.add(addr.address);
    });
  });

  const isValueRecognized = detectedIps.has(value) || value === '' || value === 'localhost';

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
          {label}
        </label>
      )}

      <div className="relative">
        <select
          value={value || '0.0.0.0'}
          disabled={disabled || loading}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono cursor-pointer disabled:opacity-50"
        >
          <option value="0.0.0.0">
            {t('common.network.interfaceSelector.allInterfaces', '0.0.0.0 (All Interfaces - Recommended)')}
          </option>
          <option value="127.0.0.1">
            {t('common.network.interfaceSelector.localhostOnly', '127.0.0.1 (Localhost Only)')}
          </option>

          {/* Group detected host interfaces */}
          {interfaces
            .filter((iface) => !iface.is_loopback && iface.ipv4_addresses.length > 0)
            .map((iface) => (
              <optgroup
                key={iface.name}
                label={`${iface.name} [${iface.is_up ? 'UP' : 'DOWN'}${
                  iface.speed > 0 ? `, ${iface.speed} Mbps` : ''
                }${iface.is_default_gateway ? ` · ${t('common.network.interfaceSelector.defaultGateway', 'Gateway')}` : ''}]`}
              >
                {iface.ipv4_addresses.map((addr) => (
                  <option key={`${iface.name}-${addr.address}`} value={addr.address}>
                    {addr.address} ({iface.name})
                  </option>
                ))}
              </optgroup>
            ))}

          {/* If the current value is not in detected IPs, show it as an alert item */}
          {!isValueRecognized && (
            <option value={value}>
              ⚠️ {value} ({t('common.network.interfaceSelector.customOrMissing', 'Configured - Not Detected')})
            </option>
          )}
        </select>
      </div>

      <p className="text-[10px] text-text-secondary flex items-center gap-1 leading-tight">
        <span>🛡️</span>
        <span>
          {helperText ||
            t(
              'common.network.interfaceSelector.failsafeNotice',
              'Safe bind: If the selected IP is down or changes, the system safely falls back to 0.0.0.0 to prevent access loss.'
            )}
        </span>
      </p>
    </div>
  );
};
