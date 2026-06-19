package com.rtcenterprise.rtc_enterprise_mobile

import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import io.flutter.embedding.android.FlutterActivity
import io.agora.agora_manager.RtcEnterpriseAndroidSdk

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            val sdk = RtcEnterpriseAndroidSdk(
                context = this,
                apiBaseUrl = "https://example.invalid/api",
                clientApiKey = "debug-smoke-key",
                agoraAppId = "debug-smoke-agora-app-id",
            )
            Log.i("RtcSdkSmoke", "RtcEnterpriseAndroidSdk loaded; fullMediaPermissions=${sdk.hasRequiredPermissions()}")
        }
    }
}
