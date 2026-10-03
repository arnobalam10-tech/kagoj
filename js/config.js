(function (K) {
  'use strict';
  // Publishable (anon) key only. The service_role key must never be here.
  K.config = {
    version: '1.0.0',
    supabaseUrl: 'https://djkvzmeziimnabxcezde.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqa3Z6bWV6aWltbmFieGNlemRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3ODUzMTksImV4cCI6MjA4MTM2MTMxOX0.5k0KvmHT61FJMDGZhOY4yvzGQW2UGuWQ1B5jXnJCvzI',
    // A login name without "@" becomes name@usernameDomain ("arnob" -> arnob@ami.com).
    usernameDomain: 'ami.com',
    pageW: 1000,
    pageH: 1414
  };
})(window.Kagoj = window.Kagoj || {});
