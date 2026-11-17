import { Pressable, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { colors } from '../theme';

export function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, style }) {
  const v = variants[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [s.btn, v.btn, (disabled || loading) && { opacity: 0.5 }, pressed && { opacity: 0.8 }, style]}
    >
      {loading ? <ActivityIndicator color={v.text.color} /> : <Text style={[s.btnText, v.text]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={s.input} {...props} />
    </View>
  );
}

export function Chip({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && s.chipActive]}>
      <Text style={[s.chipText, active && { color: colors.primaryText }]}>{label}</Text>
    </Pressable>
  );
}

export function SyncBadge({ synced }) {
  return (
    <View style={[s.badge, { backgroundColor: synced ? '#14532D' : '#713F12' }]}>
      <Text style={[s.badgeText, { color: synced ? '#86EFAC' : '#FDE68A' }]}>
        {synced ? 'Na nuvem' : 'Só no aparelho'}
      </Text>
    </View>
  );
}

const variants = {
  primary: { btn: { backgroundColor: colors.primary }, text: { color: colors.primaryText } },
  ghost: { btn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }, text: { color: colors.text } },
  danger: { btn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger }, text: { color: colors.danger } },
};

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  btn: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { fontSize: 16, fontWeight: '700' },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: colors.cardAlt, color: colors.text, borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: 14, height: 48, fontSize: 16,
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, marginRight: 8, marginBottom: 8, backgroundColor: colors.cardAlt,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: '600' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700' },
});
