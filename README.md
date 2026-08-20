# حساباتي الشهرية

تطبيق عربي RTL لتنظيم الحسابات من شهر 0 إلى شهر 12، مبني بـHTML وCSS وVanilla JavaScript وFirebase Modular. البيانات منفصلة لكل مستخدم، تتزامن فوريًا عبر Firestore، وتبقى البيانات المحمّلة متاحة دون اتصال على المتصفحات المدعومة.

## التشغيل المحلي

المتطلبات: Node.js 20 أو أحدث وحساب Firebase.

```bash
npm install
npm run dev
```

افتح العنوان الذي يظهر في الطرفية. املأ `firebase-config.js` بإعدادات تطبيقك الفعلية؛ الملف الحالي قالب واضح، و`firebase-config.example.js` نسخة مرجعية. Firebase Web Config عام ومطلوب داخل بناء الموقع الثابت، لذلك يمكن رفعه إلى المستودع. لا تضع فيه Service Account أو مفاتيح خادم. وللتحقق:

```bash
npm test
npm run build
npm run preview
```

## إعداد Firebase من الصفر

1. أنشئ مشروعًا في [Firebase Console](https://console.firebase.google.com/).
2. من **Project settings → Your apps** أضف Web App، وانسخ كائن `firebaseConfig` إلى `firebase-config.js`.
3. من **Authentication → Sign-in method** فعّل Email/Password.
4. من **Firestore Database** أنشئ قاعدة Production واختر منطقة قريبة من مستخدميك؛ لا يمكن تغيير المنطقة لاحقًا بسهولة.
5. انشر قواعد الأمان الموجودة في `firestore.rules`. باستخدام Firebase CLI:

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init firestore
   firebase deploy --only firestore:rules
   ```

   عند `firebase init` اختر المشروع الحالي واجعل مسار القواعد `firestore.rules`. لا تستبدل الملف بالقواعد المفتوحة.
6. جرّب إنشاء حساب وتسجيل الدخول، ثم أنشئ سنة وأضف دفعة. افتح جلسة أخرى بالحساب نفسه للتحقق من التزامن.

Firebase Web Config معرّف عام للتطبيق وليس سر خادم. الحماية هنا تعتمد على Authentication وقواعد Firestore التي تقيد كل المسارات بـ`request.auth.uid == userId`. يمكن أيضًا تقييد مفتاح API من Google Cloud Console بالنطاقات وواجهات Firebase المطلوبة.

## بنية البيانات

```text
users/{uid}
users/{uid}/years/{year}
users/{uid}/years/{year}/months/{0..12}
users/{uid}/years/{year}/months/{month}/payments/{paymentId}
```

تتحقق القواعد من ملكية المستخدم، نطاق السنة والشهر، كون المبلغ موجبًا، وحالة الدفع واسم الجهة. أي مسار غير معروف مرفوض افتراضيًا.

## العمل دون اتصال والتعارضات

يستخدم التطبيق تخزين Firestore الدائم متعدد علامات التبويب. يمكن عرض البيانات التي حُمّلت سابقًا وتسجيل التعديلات محليًا ثم إرسالها عند عودة الشبكة. تظهر حالة الحفظ أعلى الصفحة. عند تعديل الحقل نفسه من جهازين، يطبّق Firestore آخر كتابة تصل إلى الخادم؛ أما الدفعات المختلفة فلها معرّفات مستقلة فلا تستبدل بعضها. الحسابات لا تُحفظ ولا تتحدث تلقائيًا: هي لقطة محلية عند الضغط على زر الحساب.

## النسخ الاحتياطي والاستيراد

من زر الترس:

- **تصدير** ينزّل JSON يحتوي كل السنوات والأشهر والدفعات.
- **استيراد** يتحقق من الإصدار والسنوات والأشهر والمبالغ ثم يعرض ملخصًا. الدمج يحافظ على البيانات الأخرى؛ الاستبدال يمسح بيانات الحسابات الحالية أولًا. تُكتب الدفعات بمجموعات لا تتجاوز 400 عملية.
- **مسح جميع بياناتي** يتطلب كتابة `حذف` ثم تأكيدًا ثانيًا، ولا يحذف حساب Authentication.

احتفظ بالنسخة الاحتياطية في مكان آمن؛ فهي تحتوي بياناتك المالية كنص واضح.

## النشر على GitHub Pages

1. ارفع المشروع إلى مستودع GitHub واجعل الفرع الرئيسي `main`.
2. استبدل القالب داخل `firebase-config.js` بقيم Web App وارفعه مع المشروع. الإعداد ليس سرًا، لكن لا تضع أي مفاتيح خادم أو Service Account. إذا كانت سياسة مستودعك تمنع ذلك، يمكنك بدلًا منه توليد الملف أثناء workflow من GitHub Variables.
3. من **Settings → Pages → Build and deployment** اختر **GitHub Actions**.
4. الـworkflow في `.github/workflows/deploy.yml` يختبر ويبني وينشر `dist` تلقائيًا. `base: "./"` في Vite يجعل الأصول تعمل في أي اسم مستودع فرعي دون تعديل.
5. في Firebase Console افتح **Authentication → Settings → Authorized domains** وأضف `USERNAME.github.io`، وأضف نطاقك المخصص إن وجد.

بديل اختياري: أضف `firebase-config.js` إلى `.gitignore` وولّده في خطوة البناء بعد إنشاء GitHub Repository Variables للقيم:

```yaml
- name: Create Firebase config
  run: |
    cp firebase-config.example.js firebase-config.js
    sed -i "s/YOUR_API_KEY/${{ vars.FIREBASE_API_KEY }}/" firebase-config.js
    sed -i "s/YOUR_PROJECT_ID/${{ vars.FIREBASE_PROJECT_ID }}/g" firebase-config.js
```

ستحتاج كذلك إلى المتغيرات الأخرى أو إلى حفظ محتوى الملف كاملًا كـSecret وكتابته أثناء البناء.

## قائمة تحقق بعد ربط Firebase

- إنشاء حساب، الدخول، الخروج، واستعادة كلمة المرور.
- إنشاء/تبديل/حذف سنة، والتأكد من ظهور الأشهر 0–12.
- إضافة/تعديل/حذف دفعة وتغيير حالة الدفع من جلستين مختلفتين.
- تعديل المحفظة والمدخول وإعادة التحميل، ثم تجربة وضع Offline في DevTools.
- التأكد أن الحساب لا يحدث قبل الضغط، وأن إشعار التقادم يظهر بعد أي تعديل.
- تجربة التصدير، الدمج، والاستبدال ببيانات اختبار.
- إنشاء مستخدم ثانٍ والتأكد من عدم إمكان قراءة UID المستخدم الأول (ويفضّل اختبار القواعد عبر Firebase Emulator).
- مراجعة Console على عرض الكمبيوتر والهاتف والتأكد من عدم وجود أخطاء.

الاختبارات المحلية تغطي معادلة الحساب، عدم تغيير المدخلات، التحقق من الدفعات، والتحقق الأساسي من ملف النسخة. الاختبارات التي تحتاج خدمة Firebase حقيقية متروكة لهذه القائمة لأن المشروع لا يتضمن بيانات اعتماد المستخدم.
