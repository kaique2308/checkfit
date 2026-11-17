import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getWorkout, saveWorkout } from '../db/database';
import { Button, Chip, Field } from '../components/ui';
import { CATEGORIES, colors, todayISO } from '../theme';

export default function WorkoutFormScreen({ route, navigation }) {
  const editId = route.params?.id;
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [date, setDate] = useState(todayISO());
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: editId ? 'Editar treino' : 'Novo treino' });
    if (editId) {
      getWorkout(editId).then((w) => {
        if (!w) return;
        setTitle(w.title);
        setCategory(w.category);
        setDate(w.performed_at);
        setDuration(String(w.duration_min || ''));
        setNotes(w.notes || '');
      });
    }
  }, [editId]);

  const onSave = async () => {
    if (!title.trim()) return Alert.alert('Atenção', 'Dê um nome ao treino (ex.: Treino A - Peito).');
    if (!isValidDate(date)) return Alert.alert('Atenção', 'Data inválida. Use o formato AAAA-MM-DD (ex.: 2026-11-10).');
    setSaving(true);
    try {
      const id = await saveWorkout({
        id: editId,
        title: title.trim(),
        category,
        performed_at: date,
        duration_min: parseInt(duration, 10) || 0,
        notes,
      });
      if (editId) navigation.goBack();
      else navigation.replace('WorkoutDetail', { id });
    } catch (e) {
      Alert.alert('Erro ao salvar', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Field label="Nome do treino" placeholder="Treino A - Peito e tríceps" value={title} onChangeText={setTitle} />

        <Text style={st.label}>Categoria</Text>
        <View style={st.chips}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Data (AAAA-MM-DD)" value={date} onChangeText={setDate} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Duração (min)" keyboardType="numeric" placeholder="60" value={duration} onChangeText={setDuration} />
          </View>
        </View>

        <Field
          label="Observações"
          placeholder="Como foi o treino? Sentiu dor?"
          value={notes}
          onChangeText={setNotes}
          multiline
          style={st.textarea}
        />

        <Button title={editId ? 'Salvar alterações' : 'Criar treino'} onPress={onSave} loading={saving} />
        <Text style={st.hint}>O treino é salvo no aparelho (SQLite) e enviado à nuvem na próxima sincronização.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Aceita só datas que existem no calendário (rejeita 2026-02-31, 2026-13-01 etc.)
function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const st = StyleSheet.create({
  label: { color: colors.muted, fontSize: 13, marginBottom: 8, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  textarea: {
    backgroundColor: colors.cardAlt, color: colors.text, borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, padding: 14, minHeight: 96, fontSize: 16, textAlignVertical: 'top',
  },
  hint: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 12 },
});
