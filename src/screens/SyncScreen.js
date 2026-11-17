import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { countPending, getSetting, inspectTable } from '../db/database';
import { lastSyncs, syncNow, wipeLocalAndRestore } from '../services/sync';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { Button, Card, Chip } from '../components/ui';
import { colors } from '../theme';

export default function SyncScreen() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [table, setTable] = useState('workouts');
  const [rows, setRows] = useState([]);
  const [source, setSource] = useState('sqlite');

  useEffect(() => NetInfo.addEventListener((s) => setOnline(!!s.isConnected)), []);

  const load = useCallback(async () => {
    setPending(await countPending());
    setLogs(await lastSyncs());
  }, []);

  const loadRows = useCallback(async () => {
    try {
      if (source === 'sqlite') {
        setRows(await inspectTable(table));
      } else {
        if (!isSupabaseConfigured || table === 'sync_log') return setRows([]);
        const deviceId = await getSetting('device_id');
        const { data, error } = await supabase
          .from(table).select('*').eq('device_id', deviceId)
          .order('updated_at', { ascending: false }).limit(20);
        if (error) throw error;
        setRows(data);
      }
    } catch (e) {
      setRows([]);
      Alert.alert('Erro ao consultar', e.message);
    }
  }, [table, source]);

  useFocusEffect(useCallback(() => { load(); loadRows(); }, [load, loadRows]));

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      Alert.alert('Sincronizado', okMsg(r));
    } catch (e) {
      Alert.alert('Não foi possível sincronizar', e.message);
    } finally {
      setBusy(false);
      load();
      loadRows();
    }
  };

  const onSync = () => run(syncNow, (r) => `Enviados: ${r.pushed} · Recebidos: ${r.pulled}`);
  const onRestore = () =>
    Alert.alert(
      'Restaurar da nuvem',
      'Apaga os treinos do SQLite e baixa tudo de novo do Supabase. Use para demonstrar a persistência online.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Restaurar', style: 'destructive', onPress: () => run(wipeLocalAndRestore, (r) => `${r.pulled} registro(s) restaurado(s) do Supabase`) },
      ]
    );

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Card>
        <StatusLine icon={online ? 'wifi' : 'cloud-offline-outline'} ok={online} text={online ? 'Conectado à internet' : 'Sem internet (modo offline)'} />
        <StatusLine icon="server-outline" ok={isSupabaseConfigured} text={isSupabaseConfigured ? 'Supabase configurado' : 'Supabase não configurado (.env)'} />
        <StatusLine icon="phone-portrait-outline" ok text="SQLite local ativo (checkfit.db)" />
        <Text style={st.pending}>{pending} alteração(ões) pendentes de envio</Text>
        <Button title="Sincronizar agora" onPress={onSync} loading={busy} />
        <Button title="Restaurar dados do Supabase" variant="ghost" onPress={onRestore} disabled={busy} style={{ marginTop: 8 }} />
      </Card>

      <Text style={st.section}>Últimas sincronizações</Text>
      {logs.length === 0 && <Text style={st.muted}>Nenhuma sincronização ainda.</Text>}
      {logs.map((l) => (
        <Text key={l.id} style={st.log}>
          {new Date(l.at).toLocaleString('pt-BR')} · {l.status.toUpperCase()} · ↑{l.pushed} ↓{l.pulled}
          {l.message ? ` · ${l.message}` : ''}
        </Text>
      ))}

      <Text style={st.section}>Inspecionar dados</Text>
      <View style={st.chips}>
        <Chip label="SQLite (aparelho)" active={source === 'sqlite'} onPress={() => setSource('sqlite')} />
        <Chip label="Supabase (nuvem)" active={source === 'supabase'} onPress={() => setSource('supabase')} />
      </View>
      <View style={st.chips}>
        {['workouts', 'exercises', 'sync_log'].map((t) => (
          <Chip key={t} label={t} active={table === t} onPress={() => setTable(t)} />
        ))}
      </View>
      <Text style={st.muted}>{rows.length} registro(s) em {source === 'sqlite' ? 'SQLite' : 'Supabase'}.{table}</Text>
      {rows.map((r, i) => (
        <Card key={r.id ?? i} style={{ marginTop: 8, padding: 12 }}>
          <Text style={st.mono}>{formatRow(r)}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

function StatusLine({ icon, ok, text }) {
  return (
    <View style={st.statusLine}>
      <Ionicons name={icon} size={18} color={ok ? colors.primary : colors.danger} />
      <Text style={{ color: colors.text, marginLeft: 8 }}>{text}</Text>
    </View>
  );
}

function formatRow(r) {
  const hide = ['created_at', 'device_id'];
  return Object.entries(r)
    .filter(([k]) => !hide.includes(k))
    .map(([k, v]) => `${k}: ${k === 'id' || k === 'workout_id' ? String(v).slice(0, 8) : v}`)
    .join('\n');
}

const st = StyleSheet.create({
  statusLine: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  pending: { color: colors.warning, fontWeight: '700', marginVertical: 12 },
  section: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 24, marginBottom: 10 },
  muted: { color: colors.muted },
  log: { color: colors.muted, fontSize: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  mono: { color: colors.text, fontFamily: 'monospace', fontSize: 12 },
});
