'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { NETWORKS, NetworkConfig, NetworkId, DEFAULT_NETWORK_ID } from '@/config/networks';

interface NetworkContextType {
  networkId: NetworkId;
  currentNetwork: NetworkConfig;
  setNetworkId: (id: NetworkId) => void;
  isSepolia: boolean;
  toggleNetwork: () => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

const STORAGE_KEY = 'strk20_selected_network';

export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [networkId, setNetworkIdState] = useState<NetworkId>(DEFAULT_NETWORK_ID);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as NetworkId;
      if (saved && (saved === 'mainnet' || saved === 'sepolia')) {
        setNetworkIdState(saved);
      }
    } catch {
      // Ignore storage read errors
    }
  }, []);

  const setNetworkId = (id: NetworkId) => {
    setNetworkIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Ignore storage write errors
    }
  };

  const toggleNetwork = () => {
    setNetworkId(networkId === 'mainnet' ? 'sepolia' : 'mainnet');
  };

  const currentNetwork = NETWORKS[networkId] || NETWORKS.mainnet;
  const isSepolia = networkId === 'sepolia';

  return (
    <NetworkContext.Provider
      value={{
        networkId,
        currentNetwork,
        setNetworkId,
        isSepolia,
        toggleNetwork,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = (): NetworkContextType => {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};
