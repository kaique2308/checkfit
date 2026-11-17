import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getSetting, setSetting } from '../db/database';
import { Button, Card, Field } from '../components/ui';
import { colors } from '../theme';

export default function ProfileScreen() {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [deviceId, setDeviceId] = useState('');

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setName((await getSetting('user_name')) || '');
        setGoal((await getSetting('weekly_goal')) || '');
        setDeviceId((await getSetting('device_id')) || '');
      })();
    }, [])
  );

  const onSave = async () => {
    await setSetting('user_name', name.trim());
    await setSetting('weekly_goal', goal.trim());
    Alert.alert('Pronto', 'Perfil salvo no aparelho.');
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card>
        <Field label="Seu nome" placeholder="Kaique" value={name} onChangeText={setName} />
        <Field label="Meta de treinos por semana" keyboardType="numeric" placeholder="4" value={goal} onChangeText={setGoal} />
        <Button title="Salvar perfil" onPress={onSave} />
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Text style={st.title}>Sobre o CheckFit</Text>
        <Text style={st.text}>
          Quem treina sozinho costuma perder o controle da evolução de carga e da frequência, e muitas academias
          têm sinal ruim de internet. O CheckFit registra treinos offline no aparelho e sincroniza com a nuvem quando
          houver conexão. A câmera usa visão computacional (Pose Estimation) para contar repetições e avaliar a
          postura durante o exercício, e o resultado fica salvo junto com o treino.
        </Text>
        <Text style={st.small}>ID do aparelho: {deviceId}</Text>
      </Card>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  title: { color: colors.text, fontWeight: '700', fontSize: 16, marginBottom: 8 },
  text: { color: colors.muted, lineHeight: 20 },
  small: { color: colors.muted, fontSize: 11, marginTop: 12 },
});
