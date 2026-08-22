import { Tabs } from 'expo-router';
import { Home, FileText, FlaskConical, Pill, Settings, Calendar } from 'lucide-react-native';

export default function PatientLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0d9488', // teal-600
        tabBarInactiveTintColor: '#94a3b8', // slate-400
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: '#f1f5f9', // slate-100
          elevation: 0,
          shadowOpacity: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Home size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="appointments"
        options={{
          title: 'Book Slot',
          tabBarIcon: ({ color }) => <Calendar size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="records"
        options={{
          title: 'Records',
          tabBarIcon: ({ color }) => <FileText size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="labs"
        options={{
          title: 'Lab Tests',
          tabBarIcon: ({ color }) => <FlaskConical size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="medicines"
        options={{
          title: 'Medicines',
          tabBarIcon: ({ color }) => <Pill size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Settings size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="symptoms"
        options={{
          href: null, // Hidden from bottom tab bar, accessed from Dashboard action
        }}
      />
      <Tabs.Screen
        name="consents"
        options={{
          href: null, // Hidden from bottom tab bar, accessed from Settings
        }}
      />
    </Tabs>
  );
}
