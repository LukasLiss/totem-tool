import React, { createContext, useState } from "react";

type DashboardContextType = {
  selectedDashboard: number | null;
  setSelectedDashboard: (id: number | null) => void;
};

export const DashboardContext = createContext<DashboardContextType>({
  selectedDashboard: null,
  setSelectedDashboard: () => {},
});

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedDashboard, setSelectedDashboard] = useState<number | null>(null);

  return (
    <DashboardContext.Provider value={{ selectedDashboard, setSelectedDashboard }}>
      {children}
    </DashboardContext.Provider>
  );
};
