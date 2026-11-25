import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchableSelect } from './SearchableSelect';

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
  const isSpecificIp = Boolean(
    value &&
    value !== '0.0.0.0' &&
    value !== '127.0.0.1' &&
    value !== 'localhost'
  );

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider block">
          {label}
        </label>
      )}

      <SearchableSelect
        accent="lime"
        wrapLabels
        maxDropdownWidth={440}
        value={value || '0.0.0.0'}
        disabled={disabled || loading}
        onChange={onChange}
        buttonClassName="font-mono"
        options={[
          {
            value: '0.0.0.0',
            label: t('common.network.interfaceSelector.allInterfaces', '0.0.0.0 (All Interfaces - Recommended)'),
          },
          {
            value: '127.0.0.1',
            label: t('common.network.interfaceSelector.localhostOnly', '127.0.0.1 (Localhost Only)'),
          },
          ...interfaces
            .filter((iface) => !iface.is_loopback && iface.ipv4_addresses.length > 0)
            .flatMap((iface) => {
              const groupLabel = `${iface.name} [${iface.is_up ? 'UP' : 'DOWN'}${
                iface.speed > 0 ? `, ${iface.speed} Mbps` : ''
              }${iface.is_default_gateway ? ` · ${t('common.network.interfaceSelector.defaultGateway', 'Gateway')}` : ''}]`;
              return iface.ipv4_addresses.map((addr) => ({
                value: addr.address,
                label: `${addr.address} (${iface.name})`,
                group: groupLabel,
              }));
            }),
          ...(!isValueRecognized
            ? [{
                value,
                label: `⚠️ ${value} (${t('common.network.interfaceSelector.customOrMissing', 'Configured - Not Detected')})`,
              }]
            : []),
        ]}
      />

      {isSpecificIp && (
        <div className="p-2.5 bg-amber-500/10 border border-amber-500/25 rounded-xl space-y-1.5 text-[11px] leading-snug">
          <p className="text-[var(--text-primary)] flex items-start gap-1.5 font-medium">
            <span className="text-xs shrink-0">🛡️</span>
            <span>
              {helperText ||
                t(
                  'common.network.interfaceSelector.failsafeNotice',
                  'Safe bind: If the selected IP is down or changes, the system safely falls back to 0.0.0.0 to prevent access loss.'
                )}
            </span>
          </p>
          <p className="text-amber-400 font-bold flex items-start gap-1.5">
            <span className="text-xs shrink-0">⚠️</span>
            <span>
              {t(
                'common.network.interfaceSelector.specificIpWarning',
                'Notice: The service will only be accessible through this specific IP address ({{ip}}). Ensure your network routing allows reaching this address.',
                { ip: value }
              )}
            </span>
          </p>
        </div>
      )}
    </div>
  );
};
