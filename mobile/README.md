# AgriConnect Mobile

Flutter mobile application for customer, farmer, delivery-partner, and shared marketplace workflows.

## Requirements

- Flutter 3.24+
- Dart SDK compatible with `pubspec.yaml`
- Android Studio for Android development
- Android SDK and an emulator or physical Android device

## Run

```powershell
cd mobile
flutter pub get
flutter analyze
flutter test
flutter run
```

## Android APK

```powershell
flutter build apk --release
```

The generated APK is under `build/app/outputs/flutter-apk/`.
