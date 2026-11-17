import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  deleteExercise, deleteWorkout, exerciseHistory, getWorkout, listExercises, saveExercise,
} from '../db/database';
import { Button, Card, Field, SyncBadge } from '../components/ui';
import { colors, formatDate } from '../theme';

const empty = { id: null, name: '', sets: '3', reps: '10', weight_kg: '' };

export default function WorkoutDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const [workout, setWorkout] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [history, setHistory] = useState([]);

  const load = useCallback(async () => {
    const w = await getWorkout(id);
    if (!w) return navigation.goBack();
    setWorkout(w);
    setExercises(await listExercises(id));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => { setForm(empty); setHistory([]); setModal(true); };
  const openEdit = async (e) => {
    setForm({ id: e.id, name: e.name, sets: String(e.sets), reps: String(e.reps), weight_kg: String(e.weight_kg) });
    setHistory(await exerciseHistory(e.name));
    setModal(true);
  };

  const onNameBlur = async () => {
    if (form.name.trim()) setHistory(await exerciseHistory(form.name.trim()));
  };

  const onSaveExercise = async () => {
    if (!form.name.trim()) return Alert.alert('Atenção', 'Informe o nome do exercício.');
    try {
      await saveExercise({
        id: form.id,
        workout_id: id,
        name: form.name.trim(),
        sets: Math.max(0, parseInt(form.sets, 10) || 0),
        reps: Math.max(0, parseInt(form.reps, 10) || 0),
        weight_kg: Math.max(0, parseFloat(String(form.weight_kg).replace(',', '.')) || 0),
      });
      setModal(false);
      load();
    } catch (e) {
      Alert.alert('Erro ao salvar', e.message);
    }
  };

  const analyze = (e) => navigation.navigate('PoseAnalysis', { exerciseId: e.id, exerciseName: e.name });

  // Card de Visão Computacional: leva direto à análise (ou pede um exercício primeiro)
  const onCvCardPress = () => {
    if (exercises.length === 0) {
      Alert.alert(
        'Adicione um exercício',
        'A análise fica salva em um exercício. Cadastre um (ex.: Agachamento) e depois toque em "Analisar com câmera".',
        [{ text: 'Cancelar', style: 'cancel' }, { text: 'Adicionar exercício', onPress: openNew }]
      );
    } else if (exercises.length === 1) {
      analyze(exercises[0]);
    } else {
      Alert.alert('Qual exercício analisar?', undefined, [
        ...exercises.slice(0, 6).map((e) => ({ text: e.name, onPress: () => analyze(e) })),
        { text: 'Cancelar', style: 'cancel' },
      ]);
    }
  };

  const onDeleteExercise = (e) =>
    Alert.alert('Remover exercício', `Remover "${e.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: async () => { await deleteExercise(e.id); load(); } },
    ]);

  const onDeleteWorkout = () =>
    Alert.alert('Excluir treino', 'Isso remove o treino e seus exercícios.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => { await deleteWorkout(id); navigation.goBack(); } },
    ]);

  if (!workout) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const volume = exercises.reduce((acc, e) => acc + e.sets * e.reps * e.weight_kg, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card>
          <View style={st.rowBetween}>
            <Text style={st.title}>{workout.title}</Text>
            <Pressable onPress={() => navigation.navigate('WorkoutForm', { id })} hitSlop={10}>
              <Ionicons name="create-outline" size={22} color={colors.primary} />
            </Pressable>
          </View>
          <Text style={st.meta}>{workout.category} · {formatDate(workout.performed_at)} · {workout.duration_min} min</Text>
          {!!workout.notes && <Text style={st.notes}>{workout.notes}</Text>}
          <View style={[st.rowBetween, { marginTop: 12 }]}>
            <Text style={st.volume}>Volume total: {Math.round(volume)} kg</Text>
            <SyncBadge synced={workout.synced === 1} />
          </View>
        </Card>

        <View style={[st.rowBetween, { marginTop: 20, marginBottom: 10 }]}>
          <Text style={st.section}>Exercícios</Text>
          <Pressable onPress={openNew} style={st.addBtn}>
            <Ionicons name="add" size={18} color={colors.primaryText} />
            <Text style={st.addText}>Adicionar</Text>
          </Pressable>
        </View>

        {exercises.length === 0 && (
          <Text style={st.empty}>Nenhum exercício. Adicione séries, repetições e carga.</Text>
        )}

        {exercises.map((e) => (
          <Pressable key={e.id} onPress={() => openEdit(e)} onLongPress={() => onDeleteExercise(e)}>
            <Card style={{ marginBottom: 10 }}>
              <View style={st.rowBetween}>
                <Text style={st.exName}>{e.name}</Text>
                <Text style={st.exLoad}>{e.weight_kg} kg</Text>
              </View>
              <Text style={st.meta}>{e.sets} séries × {e.reps} repetições</Text>
              {e.cv_score != null && (
                <View style={st.cvResult}>
                  <Text style={[st.cvScore, { color: scoreColor(e.cv_score) }]}>
                    Postura {Math.round(e.cv_score)}%
                  </Text>
                  <Text style={st.meta}> · {e.cv_reps} repetições contadas pela câmera</Text>
                </View>
              )}
              {!!e.cv_feedback && <Text style={st.cvFeedback}>💬 {e.cv_feedback}</Text>}
              <Pressable
                style={st.analyzeBtn}
                onPress={() => analyze(e)}
                hitSlop={6}
              >
                <Ionicons name="body-outline" size={16} color={colors.info} />
                <Text style={st.analyzeText}>{e.cv_score != null ? 'Analisar de novo' : 'Analisar com câmera'}</Text>
              </Pressable>
            </Card>
          </Pressable>
        ))}
        {exercises.length > 0 && <Text style={st.tip}>Toque para editar · segure para remover</Text>}

        <Pressable onPress={onCvCardPress}>
          <Card style={st.cvCard}>
            <Ionicons name="body-outline" size={22} color={colors.info} />
            <View style={{ flex: 1 }}>
              <Text style={st.cvTitle}>Análise de postura pela câmera</Text>
              <Text style={st.meta}>
                A câmera detecta os pontos do corpo, conta as repetições e dá uma nota de postura
                (agachamento, flexão e rosca).
              </Text>
              <Text style={st.cvAction}>
                {exercises.length === 0
                  ? 'Toque aqui para adicionar um exercício e analisar →'
                  : exercises.length === 1
                    ? `Toque aqui para analisar "${exercises[0].name}" →`
                    : 'Toque aqui e escolha o exercício para analisar →'}
              </Text>
            </View>
          </Card>
        </Pressable>

        <Button title="Excluir treino" variant="danger" onPress={onDeleteWorkout} style={{ marginTop: 20 }} />
      </ScrollView>

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.modalWrap}>
          <View style={st.sheet}>
            <Text style={st.section}>{form.id ? 'Editar exercício' : 'Novo exercício'}</Text>
            <View style={{ height: 12 }} />
            <Field
              label="Exercício"
              placeholder="Supino reto"
              value={form.name}
              onChangeText={(v) => setForm({ ...form, name: v })}
              onBlur={onNameBlur}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="Séries" keyboardType="numeric" value={form.sets} onChangeText={(v) => setForm({ ...form, sets: v })} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Reps" keyboardType="numeric" value={form.reps} onChangeText={(v) => setForm({ ...form, reps: v })} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Carga (kg)" keyboardType="decimal-pad" value={form.weight_kg} onChangeText={(v) => setForm({ ...form, weight_kg: v })} />
              </View>
            </View>

            {history.length > 0 && (
              <View style={st.history}>
                <Text style={st.historyTitle}>Últimas vezes que você fez</Text>
                {history.map((h, i) => (
                  <Text key={i} style={st.meta}>
                    {formatDate(h.performed_at)}: {h.sets}×{h.reps} com {h.weight_kg} kg
                    {h.cv_score != null ? ` · postura ${Math.round(h.cv_score)}%` : ''}
                  </Text>
                ))}
              </View>
            )}

            <Button title="Salvar" onPress={onSaveExercise} />
            <Button title="Cancelar" variant="ghost" onPress={() => setModal(false)} style={{ marginTop: 8 }} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const scoreColor = (s) => (s >= 80 ? colors.primary : s >= 60 ? colors.warning : colors.danger);

const st = StyleSheet.create({
  cvResult: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 6 },
  cvScore: { fontWeight: '800' },
  cvFeedback: { color: colors.warning, marginTop: 4, fontSize: 13 },
  analyzeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10,
    borderWidth: 1, borderColor: colors.info, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  analyzeText: { color: colors.info, fontWeight: '700', fontSize: 13 },
  cvAction: { color: colors.info, fontWeight: '700', marginTop: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', flex: 1 },
  meta: { color: colors.muted, marginTop: 4 },
  notes: { color: colors.text, marginTop: 10, fontStyle: 'italic' },
  volume: { color: colors.primary, fontWeight: '700' },
  section: { color: colors.text, fontSize: 18, fontWeight: '700' },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  addText: { color: colors.primaryText, fontWeight: '700', marginLeft: 4 },
  empty: { color: colors.muted, marginBottom: 10 },
  exName: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
  exLoad: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  tip: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 2 },
  cvCard: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 20, borderColor: colors.info },
  cvTitle: { color: colors.text, fontWeight: '700' },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: colors.card, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 36 },
  history: { backgroundColor: colors.cardAlt, borderRadius: 12, padding: 12, marginBottom: 14 },
  historyTitle: { color: colors.text, fontWeight: '700' },
});
