# OkHttp checks optional TLS providers by reflection. The app does not ship
# these provider implementations, so R8 should not fail the release build.
-dontwarn org.bouncycastle.jsse.provider.BouncyCastleJsseProvider
-dontwarn org.conscrypt.Conscrypt$Version
-dontwarn org.conscrypt.Conscrypt
-dontwarn org.conscrypt.ConscryptHostnameVerifier
-dontwarn org.openjsse.net.ssl.OpenJSSE
