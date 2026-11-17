import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { saveCvResult } from '../db/database';
import { buildPoseHtml, guessMode, MODES } from '../vision/pose';
import { Button, Chip } from '../components/ui';
import { colors } from '../theme';

// Tela de Visão Computacional: câmera + Pose Estimation (MediaPipe) em tempo real.
// Ao salvar, o resultado vai para o SQLite e, na sincronização, para o Supabase.
export default function PoseAnalysisScreen({ route, navigation }) {
  const { exerciseId, exerciseName } = route.params;
  const webRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState(() => guessMode(exerciseName));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Carregando modelo de pose...');
  const [angle, setAngle] = useState(null);
  const [result, setResult] = useState({ reps: 0, score: 0, lastScore: null, feedback: '' });
  const [saving, setSaving] = useState(false);
  const [webKey, setWebKey] = useState(0);

  // O HTML é montado uma vez por carregamento; trocar de exercício é feito por comando
  const html = useMemo(() => buildPoseHtml(mode), [webKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (cmd) =>
    webRef.current?.injectJavaScript(`window.cmd && window.cmd(${JSON.stringify(cmd)}); true;`);

  const onMessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') { setReady(true); setError(null); }
    else if (msg.type === 'status') setStatus(msg.message);
    else if (msg.type === 'angle') setAngle(msg.angle);
    else if (msg.type === 'update') setResult(msg);
    else if (msg.type === 'error') setError(msg.message);
  };

  const changeMode = (m) => {
    setMode(m);
    setAngle(null);
    send({ type: 'mode', mode: m });
  };

  const retry = () => {
    setError(null);
    setReady(false);
    setStatus('Carregando modelo de pose...');
    setResult({ reps: 0, score: 0, lastScore: null, feedback: '' });
    setWebKey((k) => k + 1);
  };

  const onSave = async () => {
    if (result.reps === 0) {
      return Alert.alert('Nenhuma repetição', 'Faça pelo menos uma repetição completa diante da câmera.');
    }
    setSaving(true);
    try {
      await saveCvResult(exerciseId, { reps: result.reps, score: result.score, feedback: result.feedback });
      Alert.alert(
        'Análise salva',
        `${result.reps} repetição(ões) · postura ${result.score}%.\nSalvo no aparelho (SQLite). Sincronize para enviar ao Supabase.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      Alert.alert('Erro ao salvar', e.message);
    } finally {
      setSaving(false);
    }
  };

  // Permissão da câmera
  if (!permission) {
    return <View style={st.center}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={st.center}>
        <Ionicons name="camera-outline" size={48} color={colors.muted} />
        <Text style={st.permTitle}>Permitir acesso à câmera</Text>
        <Text style={st.permText}>
          A câmera é usada para detectar os pontos do corpo, contar repetições e avaliar a postura.
          As imagens não são gravadas nem enviadas: só o resultado fica salvo.
        </Text>
        {permission.canAskAgain ? (
          <Button title="Permitir câmera" onPress={requestPermission} style={{ alignSelf: 'stretch' }} />
        ) : (
          <>
            <Text style={st.permText}>
              O acesso foi negado antes. Abra os Ajustes e ative a Câmera para o Expo Go.
            </Text>
            <Button title="Abrir Ajustes" onPress={() => Linking.openSettings()} style={{ alignSelf: 'stretch' }} />
          </>
        )}
      </View>
    );
  }

  const scoreColor = result.score >= 80 ? colors.primary : result.score >= 60 ? colors.warning : colors.danger;

  return (
    <View style={st.container}>
      <View style={st.cameraBox}>
        <WebView
          key={webKey}
          ref={webRef}
          source={{ html, baseUrl: 'https://localhost/' }}
          originWhitelist={['*']}
          onMessage={onMessage}
          javaScriptEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          style={st.web}
          containerStyle={st.web}
          scrollEnabled={false}
          bounces={false}
        />

        {/* Placar ao vivo */}
        <View style={st.overlayTop} pointerEvents="none">
          <View style={st.counter}>
            <Text style={st.counterValue}>{result.reps}</Text>
            <Text style={st.counterLabel}>repetições</Text>
          </View>
          <View style={st.counter}>
            <Text style={[st.counterValue, { color: result.reps ? scoreColor : colors.muted }]}>
              {result.reps ? `${result.score}%` : '--'}
            </Text>
            <Text style={st.counterLabel}>postura</Text>
          </View>
          {angle != null && (
            <View style={st.counter}>
              <Text style={st.angleValue}>{angle}°</Text>
              <Text style={st.counterLabel}>{MODES[mode].joint}</Text>
            </View>
          )}
        </View>

        {!ready && !error && (
          <View style={st.loading} pointerEvents="none">
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={st.loadingText}>{status}</Text>
          </View>
        )}

        {error && (
          <View style={st.loading}>
            <Ionicons name="warning-outline" size={36} color={colors.danger} />
            <Text style={[st.loadingText, { color: colors.text }]}>{error}</Text>
            <Button title="Tentar de novo" onPress={retry} style={{ marginTop: 12, alignSelf: 'stretch' }} />
          </View>
        )}

        {ready && !error && (
          <View style={st.statusPill} pointerEvents="none">
            <Text style={st.statusText}>{status}</Text>
          </View>
        )}
      </View>

      <View style={st.panel}>
        <Text style={st.exName} numberOfLines={1}>{exerciseName}</Text>
        {!!result.feedback && <Text style={st.feedback}>💬 {result.feedback}</Text>}

        <View style={st.chips}>
          {Object.entries(MODES).map(([key, m]) => (
            <Chip key={key} label={m.label} active={mode === key} onPress={() => changeMode(key)} />
          ))}
        </View>

        <View style={st.row}>
          <Pressable style={st.iconBtn} onPress={() => send({ type: 'reset' })}>
            <Ionicons name="refresh" size={20} color={colors.text} />
            <Text style={st.iconText}>Zerar</Text>
          </Pressable>
          <Pressable style={st.iconBtn} onPress={() => send({ type: 'flip' })}>
            <Ionicons name="camera-reverse-outline" size={20} color={colors.text} />
            <Text style={st.iconText}>Virar câmera</Text>
          </Pressable>
        </View>

        <Button title="Salvar análise" onPress={onSave} loading={saving} />
        <Text style={st.hint}>
          Dica: deixe o celular apoiado, de lado para você, com o corpo inteiro aparecendo.
        </Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  permTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  permText: { color: colors.muted, textAlign: 'center', marginBottom: 8 },
  cameraBox: { flex: 1, backgroundColor: '#000' },
  web: { flex: 1, backgroundColor: '#000' },
  overlayTop: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', gap: 8 },
  counter: { backgroundColor: 'rgba(11,18,32,0.8)', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center' },
  counterValue: { color: colors.primary, fontSize: 30, fontWeight: '800' },
  angleValue: { color: colors.info, fontSize: 30, fontWeight: '800' },
  counterLabel: { color: colors.muted, fontSize: 11 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(11,18,32,0.85)' },
  loadingText: { color: colors.muted, marginTop: 12, textAlign: 'center' },
  statusPill: { position: 'absolute', bottom: 12, alignSelf: 'center', backgroundColor: 'rgba(11,18,32,0.8)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  statusText: { color: colors.text, fontWeight: '600' },
  panel: { backgroundColor: colors.card, padding: 16, paddingBottom: 28, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  exName: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  feedback: { color: colors.warning, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  iconBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 10 },
  iconText: { color: colors.text, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 10 },
});
