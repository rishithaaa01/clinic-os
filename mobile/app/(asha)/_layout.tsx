import React from 'react';
import { Tabs } from 'expo-router';
import { Home, Users, Stethoscope, ArrowUpRight, User } from 'lucide-react-native';

export default function AshaLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: '#0d9488',
      tabBarInactiveTintColor: '#94a3b8',
      tabBarStyle: {
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#f1f5f9',
        height: 64,
        paddingBottom: 8,
        paddingTop: 8,
      }
    }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="households"
        options={{
          title: 'Households',
          tabBarIcon: ({ color, size }) => <Users size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="screening"
        options={{
          title: 'Screening',
          tabBarIcon: ({ color, size }) => <Stethoscope size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="referrals"
        options={{
          title: 'Referrals',
          tabBarIcon: ({ color, size }) => <ArrowUpRight size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
