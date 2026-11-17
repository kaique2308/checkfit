import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { listWorkouts, getStats, getSetting } from '../db/database';
import { Card, SyncBadge } from '../components/ui';
import { colors, formatDate } from '../theme';

export default function HomeScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({
    total: 0, week: 0, weekMinutes: 0, weekVolume: 0, pending: 0, postureAvg: null, postureCount: 0,
  });
  const [name, setName] = useState('');
  const [goal, setGoal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [w, s, n, g] = await Promise.all([
      listWorkouts(), getStats(), getSetting('user_name'), getSetting('weekly_goal'),
    ]);
    setItems(w);
    setStats(s);
    setName(n || '');
    setGoal(parseInt(g, 10) || 0);
  }, []);

  const progress = goal > 0 ? Math.min(stats.week / goal, 1) : 0;
  const goalReached = goal > 0 && stats.week >= goal;

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const header = (
    <View>
      <Text style={st.hello}>Olá{name ? `, ${name}` : ''} 👋</Text>
      <Text style={st.sub}>Seu histórico de treinos, mesmo sem internet.</Text>

      <View style={st.statsRow}>
        <Stat label="Treinos na semana" value={stats.week} />
        <Stat label="Minutos na semana" value={stats.weekMinutes} />
        <Stat label="Volume na semana (kg)" value={formatKg(stats.weekVolume)} />
      </View>

      {goal > 0 ? (
        <Card style={st.goalCard}>
          <View style={st.rowBetween}>
            <Text style={st.goalTitle}>Meta da semana</Text>
            <Text style={[st.goalCount, goalReached && { color: colors.primary }]}>
              {stats.week} de {goal} treinos
            </Text>
          </View>
          <View style={st.barBg}>
            <View style={[st.barFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={st.goalHint}>
            {goalReached
              ? 'Meta batida! 🎉'
              : `Faltam ${goal - stats.week} treino(s) nos últimos 7 dias.`}
          </Text>
        </Card>
      ) : (
        <Pressable onPress={() => navigation.navigate('ProfileTab')}>
          <Card style={st.goalCard}>
            <Text style={st.goalHint}>Defina sua meta de treinos por semana na aba Perfil.</Text>
          </Card>
        </Pressable>
      )}

      {stats.postureAvg != null && (
        <Card style={st.postureCard}>
          <Ionicons name="body-outline" size={22} color={colors.info} />
          <View style={{ flex: 1 }}>
            <Text style={st.goalTitle}>Postura média na semana: {stats.postureAvg}%</Text>
            <Text style={st.goalHint}>
              {stats.postureCount} exercício(s) analisado(s) pela câmera
              {stats.postureAvg >= 80 ? ' · execução boa' : ' · veja as dicas em cada exercício'}
            </Text>
          </View>
        </Card>
      )}

      {stats.pending > 0 && (
        <Pressable onPress={() => navigation.navigate('SyncTab')}>
          <Card style={st.pending}>
            <Ionicons name="cloud-upload-outline" size={20} color={colors.warning} />
            <Text style={st.pendingText}>{stats.pending} alteração(ões) aguardando sincronização</Text>
          </Card>
        </Pressable>
      )}
      <Text style={st.section}>
        Treinos recentes{stats.total > 0 ? <Text style={st.sectionCount}> · {stats.total} no total</Text> : null}
      </Text>
    </View>
  );

  return (
    <View style={st.container}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Ionicons name="barbell-outline" size={40} color={colors.muted} />
            <Text style={st.empty}>Nenhum treino ainda. Toque no + para registrar o primeiro.</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('WorkoutDetail', { id: item.id })}>
            <Card style={{ marginBottom: 12 }}>
              <View style={st.rowBetween}>
                <Text style={st.title}>{item.title}</Text>
                <SyncBadge synced={item.synced === 1} />
              </View>
              <Text style={st.meta}>
                {item.category} · {formatDate(item.performed_at)} · {item.duration_min} min
              </Text>
              <Text style={st.meta}>
                {item.exercise_count} exercício(s) · volume {Math.round(item.volume)} kg
              </Text>
            </Card>
          </Pressable>
        )}
      />
      <Pressable style={st.fab} onPress={() => navigation.navigate('WorkoutForm')}>
        <Ionicons name="add" size={30} color={colors.primaryText} />
      </Pressable>
    </View>
  );
}

function Stat({ label, value }) {
  return (
    <Card style={st.stat}>
      <Text style={st.statValue}>{value}</Text>
      <Text style={st.statLabel}>{label}</Text>
    </Card>
  );
}

// 12500 -> "12,5 mil"; 850 -> "850"
function formatKg(v) {
  const n = Math.round(v || 0);
  if (n < 1000) return String(n);
  const mil = (n / 1000).toFixed(n < 10000 ? 1 : 0).replace('.', ',').replace(/,0$/, '');
  return `${mil} mil`;
}

const st = StyleSheet.create({
  goalCard: { marginBottom: 12 },
  postureCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, borderColor: colors.info },
  goalTitle: { color: colors.text, fontWeight: '700' },
  goalCount: { color: colors.muted, fontWeight: '700' },
  barBg: { height: 8, borderRadius: 999, backgroundColor: colors.cardAlt, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 999, backgroundColor: colors.primary },
  goalHint: { color: colors.muted, marginTop: 8, fontSize: 13 },
  sectionCount: { color: colors.muted, fontSize: 14, fontWeight: '400' },
  container: { flex: 1, backgroundColor: colors.bg },
  hello: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.muted, marginTop: 4, marginBottom: 16 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  stat: { flex: 1, padding: 12 },
  statValue: { color: colors.primary, fontSize: 24, fontWeight: '800' },
  statLabel: { color: colors.muted, fontSize: 11, marginTop: 2 },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: colors.warning, marginBottom: 12 },
  pendingText: { color: colors.warning, fontWeight: '600', flex: 1 },
  section: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 8, marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', flex: 1 },
  meta: { color: colors.muted, marginTop: 4 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 10 },
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 6,
  },
});
