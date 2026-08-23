import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInRight,
  FadeOut,
  FadeOutLeft,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, type Guest } from '@/api/client';
import { AuthDecor } from '@/components/auth-decor';
import { CodeInput } from '@/components/code-input';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { formatPhone, isPhoneComplete, toApiPhone } from '@/lib/phone';
import { tenant } from '@/lib/tenant';
import { useSession } from '@/store/session';
import { keyboardScroll } from '@/lib/keyboard';
import { mapsAvailable } from '@/lib/tenant';
import { useTheme } from '@/theme/theme-provider';

type Step = 'phone' | 'code' | 'name';

const STEPS: Step[] = ['phone', 'code', 'name'];

const GENDERS = [
  { value: 'female' as const, label: 'Женский' },
  { value: 'male' as const, label: 'Мужской' },
];

/** 15.08.1990 → 1990-08-15, иначе null. */
function toIsoBirthday(input: string): string | null {
  const match = input.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function maskBirthday(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(
    (part) => part.length > 0,
  );
  return parts.join('.');
}

export default function AuthScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const signIn = useSession((state) => state.signIn);
  const setGuest = useSession((state) => state.setGuest);

  // Гость мог свернуть приложение прямо на знакомстве — тогда возвращаем его туда же
  const params = useLocalSearchParams<{ step?: string; next?: string }>();
  const [step, setStep] = useState<Step>(params.step === 'name' ? 'name' : 'phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const guest = useSession((state) => state.guest);
  const [name, setName] = useState(guest?.name ?? '');
  const [gender, setGender] = useState<Guest['gender']>(null);
  const [birthday, setBirthday] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  // Билет на регистрацию: телефон подтверждён, но гостя в базе ещё нет
  const [signupToken, setSignupToken] = useState<string | null>(null);

  const submittedCode = useRef('');

  // Свайп вниз закрыл бы окно прямо посреди входа: на коде потерялся бы код,
  // на знакомстве остался бы гость без имени. Разрешаем уйти только с первого шага
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: step === 'phone' });
  }, [navigation, step]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const requestCode = useMutation({
    mutationFn: () => api.requestCode(toApiPhone(phone)),
    onSuccess: (result) => {
      setFailure(null);
      setCode('');
      submittedCode.current = '';
      setResendIn(result.resend_after_seconds);
      setStep('code');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  const verifyCode = useMutation({
    mutationFn: (value: string) => api.verifyCode(toApiPhone(phone), value),
    onSuccess: async (result) => {
      setFailure(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Незнакомый номер: в базе пока ничего нет, ждём имя
      if (result.kind === 'signup') {
        setSignupToken(result.signup_token);
        setStep('name');
        return;
      }

      await signIn(result);

      // Старые гости могли остаться без имени — просим дозаполнить
      if (!result.guest.name) {
        setStep('name');
        return;
      }

      void finish();
    },
    onError: (error: ApiError) => {
      setFailure(error.message);
      setCode('');
      submittedCode.current = '';
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const saveProfile = useMutation({
    mutationFn: async () => {
      const iso = birthday.trim().length > 0 ? toIsoBirthday(birthday) : null;
      if (birthday.trim().length > 0 && iso === null) {
        throw new ApiError(0, 'Дата рождения в формате 15.08.1990');
      }

      if (signupToken !== null) {
        const session = await api.signup({
          signup_token: signupToken,
          name: name.trim(),
          gender,
          birthday: iso,
          // Согласие на акции по умолчанию есть, отключается тумблером в профиле
          marketing_opt_in: true,
        });
        await signIn(session);
        return;
      }

      const guest = await api.updateMe({ name: name.trim(), gender, birthday: iso });
      setGuest(guest);
    },
    onSuccess: () => {
      setFailure(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void finish();
    },
    onError: (error: ApiError) => setFailure(error.message),
  });

  // Код из четырёх цифр отправляем сами — лишнее нажатие тут никому не нужно
  useEffect(() => {
    if (step === 'code' && code.length === 4 && submittedCode.current !== code) {
      submittedCode.current = code;
      verifyCode.mutate(code);
    }
  }, [code, step, verifyCode]);

  const progress = useDerivedValue(() =>
    withTiming((STEPS.indexOf(step) + 1) / STEPS.length, {
      duration: theme.motion.duration.base,
    }),
  );

  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const busy = requestCode.isPending || verifyCode.isPending || saveProfile.isPending;

  // Пришли из шапки меню за доставкой. Новый адрес просим только у того,
  // у кого его ещё нет: у старого гостя адреса уже сохранены
  const finish = async () => {
    if (params.next !== 'address') {
      router.back();
      return;
    }

    const saved = await api.addresses().catch(() => []);
    if (saved.length === 0) {
      router.replace(
        mapsAvailable
          ? { pathname: '/address-map', params: { next: 'form' } }
          : { pathname: '/address-form', params: { onboarding: '1' } },
      );
      return;
    }

    router.back();
  };

  const goBack = () => {
    setFailure(null);
    if (step === 'code') {
      setStep('phone');
      return;
    }
    router.back();
  };

  const copy = useMemo(() => {
    switch (step) {
      case 'phone':
        return {
          title: 'Ваш номер',
          text: `Пришлём код подтверждения. За регистрацию начислим ${tenant.loyalty.welcomeBonus} приветственных баллов.`,
        };
      case 'code':
        return {
          title: 'Код из SMS',
          text: `Отправили на ${formatPhone(phone)}. Пока это тестовый режим — подойдёт код 0000.`,
        };
      default:
        return { title: 'Знакомимся', text: 'Как к вам обращаться?' };
    }
  }, [step, phone]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: theme.colors.background }]}
    >
      {step === 'phone' ? <AuthDecor variant="photo" /> : null}
      {step === 'phone' ? null : <AuthDecor variant="icons" />}

      <View
        style={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.layout.screenPadding,
          gap: theme.spacing.base,
        }}
      >
        <View style={[styles.bar, { backgroundColor: theme.colors.surfaceSunken }]}>
          <Animated.View
            style={[styles.barFill, progressStyle, { backgroundColor: theme.colors.brand }]}
          />
        </View>

        {step === 'name' ? (
          // С этого шага выхода нет: гость с одним номером и без имени
          // нам не пригодится, а ему потом непонятно, кто он в приложении
          <View style={{ height: theme.layout.minTouchTarget }} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Назад"
            hitSlop={theme.hitSlop}
            onPress={goBack}
            style={[
              styles.back,
              {
                width: theme.layout.minTouchTarget,
                height: theme.layout.minTouchTarget,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.surfaceSunken,
              },
            ]}
          >
            <Ionicons
              name={step === 'phone' ? 'close' : 'chevron-back'}
              size={22}
              color={theme.colors.textPrimary}
            />
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: theme.layout.screenPadding,
          // На первом шаге освобождаем полосу под кадр с пиццей
          paddingTop: step === 'phone' ? theme.spacing.huge * 2.3 : theme.spacing.base,
          paddingBottom: insets.bottom + theme.spacing.xxl,
          gap: theme.spacing.lg,
        }}
        {...keyboardScroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View key={`${step}-head`} entering={FadeIn.duration(220)} style={{ gap: theme.spacing.xs }}>
          <Text style={[theme.typography.display, { color: theme.colors.textPrimary }]}>
            {copy.title}
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
            {copy.text}
          </Text>
        </Animated.View>

        {step === 'phone' ? (
          <Animated.View
            key="phone"
            entering={FadeInRight.duration(260)}
            exiting={FadeOutLeft.duration(160)}
            style={{ gap: theme.spacing.lg }}
          >
            <TextField
              label="Телефон"
              value={phone}
              onChangeText={(next) => setPhone(formatPhone(next))}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              error={failure}
            />

            <PrimaryButton
              label="Получить код"
              loading={requestCode.isPending}
              disabled={!isPhoneComplete(phone) || busy}
              onPress={() => {
                setFailure(null);
                requestCode.mutate();
              }}
            />

            <Text
              style={[theme.typography.caption, styles.legal, { color: theme.colors.textTertiary }]}
            >
              Нажимая «Получить код», вы соглашаетесь на обработку персональных данных.
            </Text>
          </Animated.View>
        ) : null}

        {step === 'code' ? (
          <Animated.View
            key="code"
            entering={FadeInRight.duration(260)}
            exiting={FadeOutLeft.duration(160)}
            style={{ gap: theme.spacing.lg }}
          >
            <CodeInput value={code} onChange={setCode} invalid={Boolean(failure)} />

            {failure ? (
              <Animated.Text
                entering={FadeIn}
                exiting={FadeOut}
                style={[theme.typography.caption, styles.legal, { color: theme.colors.danger }]}
              >
                {failure}
              </Animated.Text>
            ) : null}

            <View style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
              {verifyCode.isPending ? (
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.textSecondary }]}>
                  Проверяем код…
                </Text>
              ) : resendIn > 0 ? (
                <Text style={[theme.typography.body, { color: theme.colors.textTertiary }]}>
                  Отправить снова через {resendIn} с
                </Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={theme.hitSlop}
                  onPress={() => requestCode.mutate()}
                  style={{ paddingVertical: theme.spacing.sm }}
                >
                  <Text style={[theme.typography.bodyMedium, { color: theme.colors.brand }]}>
                    Отправить код ещё раз
                  </Text>
                </Pressable>
              )}
            </View>
          </Animated.View>
        ) : null}

        {step === 'name' ? (
          <Animated.View
            key="name"
            entering={FadeInRight.duration(260)}
            exiting={FadeOutLeft.duration(160)}
            style={{ gap: theme.spacing.lg }}
          >
            <TextField
              label="Имя"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              textContentType="givenName"
              error={failure}
            />

            <View style={{ gap: theme.spacing.sm }}>
              <Text style={[theme.typography.overline, { color: theme.colors.textTertiary }]}>
                Пол — по желанию
              </Text>
              <View style={[styles.row, { gap: theme.spacing.sm }]}>
                {GENDERS.map((option) => {
                  const selected = gender === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setGender(selected ? null : option.value)}
                      style={[
                        styles.chip,
                        {
                          minHeight: theme.layout.minTouchTarget,
                          borderRadius: theme.radius.pill,
                          borderColor: selected ? theme.colors.brand : theme.colors.border,
                          backgroundColor: selected
                            ? theme.colors.brandSubtle
                            : theme.colors.surface,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          theme.typography.bodyMedium,
                          { color: selected ? theme.colors.brand : theme.colors.textSecondary },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <TextField
              label="Дата рождения"
              hint="Подарим бонус ко дню рождения"
              value={birthday}
              onChangeText={(next) => setBirthday(maskBirthday(next))}
              keyboardType="number-pad"
              placeholder="15.08.1990"
            />

            <PrimaryButton
              label="Продолжить"
              loading={saveProfile.isPending}
              disabled={name.trim().length < 2 || busy}
              onPress={() => {
                setFailure(null);
                saveProfile.mutate();
              }}
            />

          </Animated.View>
        ) : null}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { height: 3, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 3, borderRadius: 2 },
  back: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row' },
  chip: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  legal: { textAlign: 'center' },
});
